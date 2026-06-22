// In-memory prefix index (CLAUDE.md §6).
//
// WHY A TRIE: walking a prefix is O(L) in the prefix LENGTH, independent of how
// many queries exist (100k or 10M, typing "iph" is the same 3-hop walk). This
// beats:
//   - scanning the query->count map every keystroke (O(N) per stroke), and
//   - precomputing a prefix->top10 map (memory explosion + painful updates).
//
// Top-k is computed ON A CACHE MISS by a bounded traversal of the matched
// subtree (no per-node cached top-k lists). Redis then caches the computed
// prefix->suggestions, so the trie computes on miss and Redis serves hits.
//
// We also keep an authoritative `query -> count` Map alongside the trie: it is
// the in-process count store, kept in sync with Postgres at load and on insert,
// and is what /search increments conceptually feed.

class TrieNode {
  constructor() {
    this.children = new Map(); // char -> TrieNode
    this.isWord = false;       // does a complete query end here?
  }
}

export class Trie {
  constructor() {
    this.root = new TrieNode();
    this.counts = new Map(); // query -> count (authoritative in-process store)
    this.size = 0;           // number of distinct queries indexed
  }

  // Insert or update a query with an absolute count. Idempotent on the trie path.
  insert(query, count) {
    const q = query.toLowerCase().trim();
    if (!q) return;
    let node = this.root;
    for (const ch of q) {
      let next = node.children.get(ch);
      if (!next) { next = new TrieNode(); node.children.set(ch, next); }
      node = next;
    }
    if (!node.isWord) { node.isWord = true; this.size++; }
    this.counts.set(q, count);
  }

  // Bulk load — used at startup from Postgres rows.
  bulkLoad(rows) {
    for (const { query, count } of rows) this.insert(query, Number(count));
  }

  getCount(query) {
    return this.counts.get(query.toLowerCase().trim()) ?? 0;
  }

  // Add 1 to a query (used when /search sees a brand-new query so it becomes
  // suggestible immediately). Returns true if the query was newly inserted.
  bumpNew(query) {
    const q = query.toLowerCase().trim();
    if (!q) return false;
    if (this.counts.has(q)) return false;
    this.insert(q, 1);
    return true;
  }

  // Walk to the node representing `prefix`. Returns null if the prefix path
  // doesn't exist (=> no suggestions). This walk is the O(L) part.
  _walk(prefix) {
    let node = this.root;
    for (const ch of prefix) {
      node = node.children.get(ch);
      if (!node) return null;
    }
    return node;
  }

  // Top-k queries under `prefix`, sorted by count DESC then query ASC.
  // CLAUDE.md §6: the basic sort is deliberately "dumb" — count desc, ties
  // alphabetical, NO recency (recency belongs to trending) so the basic-vs-
  // enhanced comparison stays clean.
  topK(prefix, k = 10) {
    const p = (prefix || '').toLowerCase().trim();
    if (!p) return [];
    const start = this._walk(p);
    if (!start) return [];

    // Collect every complete query in the subtree, then pick top-k. The subtree
    // is bounded by the number of completions of the prefix, not the dataset.
    const matches = [];
    const stack = [[start, p]];
    while (stack.length) {
      const [node, str] = stack.pop();
      if (node.isWord) matches.push({ query: str, count: this.counts.get(str) ?? 0 });
      for (const [ch, child] of node.children) stack.push([child, str + ch]);
    }

    matches.sort((a, b) => (b.count - a.count) || (a.query < b.query ? -1 : a.query > b.query ? 1 : 0));
    return matches.slice(0, k);
  }
}

// Module-level singleton — one trie per server process.
export const trie = new Trie();

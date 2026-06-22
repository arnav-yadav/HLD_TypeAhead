// Cache-aside read path for suggestions (CLAUDE.md §7).
//
// READ PATH:
//   1. Normalize prefix -> ring -> responsible Redis node.
//   2. HIT  -> return cached suggestions (fast path).
//   3. MISS -> compute top-10 from the trie, return to the user, AND back-fill
//      the routed node so the next request hits.
//
// The user ALWAYS gets an answer; a miss is merely slower, never empty.
//
// WHAT'S CACHED: `suggest:<prefix>` -> JSON list of { query, count } where count
// is a ROUNDED snapshot taken at write time. Exact live counts are not cached, so
// a count ticking 88000->88003 never churns the cache (the order didn't change).
//
// INVALIDATION: TTL-only (SET ... EX). The batch flush keeps Postgres fresh but
// does NOT touch Redis — only TTL expiry pulls fresh data. The two clocks are
// decoupled by design; we accept <= TTL staleness on ordering because top-k
// orderings are stable.
import { clientForKey } from './clients.js';
import { trie } from '../trie/trie.js';
import { config } from '../config.js';
import { metrics } from '../metrics/metrics.js';

const keyFor = (prefix) => `suggest:${prefix}`;

// Round a count for display: 88000 -> "88k". Cached as the snapshot value so
// small live changes don't invalidate ordering. We store the numeric rounded
// value and let the frontend format the label.
function roundCount(n) {
  if (n < 1000) return n;
  if (n < 10000) return Math.round(n / 100) * 100;   // nearest 100
  return Math.round(n / 1000) * 1000;                 // nearest 1000
}

// Returns { prefix, suggestions, hit, node }. Never throws on cache errors —
// degrades to trie computation.
export async function getSuggestions(rawPrefix) {
  const prefix = (rawPrefix || '').toLowerCase().trim();
  if (!prefix) return { prefix, suggestions: [], hit: false, node: null };

  const key = keyFor(prefix);
  const { node, client } = clientForKey(key);

  // 1 + 2: try cache.
  try {
    const cached = await client.get(key);
    if (cached) {
      metrics.incrCacheHit();
      return { prefix, suggestions: JSON.parse(cached), hit: true, node };
    }
  } catch {
    // Redis unavailable -> fall through to compute (still serve the user).
  }

  // 3: MISS -> compute from trie.
  metrics.incrCacheMiss();
  const computed = trie.topK(prefix, 10).map((s) => ({ query: s.query, count: roundCount(s.count) }));

  // Back-fill (best-effort; never block the response on a cache write failure).
  try {
    await client.set(key, JSON.stringify(computed), 'EX', config.suggestTtlSeconds);
  } catch { /* ignore */ }

  return { prefix, suggestions: computed, hit: false, node };
}

// Routing-only lookup for /cache/debug: which node owns the prefix + is it cached
// right now (without recording a hit/miss in the live metrics).
export async function debugRouting(rawPrefix) {
  const prefix = (rawPrefix || '').toLowerCase().trim();
  const key = keyFor(prefix);
  const { node, client } = clientForKey(key);
  let hit = false;
  try { hit = (await client.exists(key)) === 1; } catch { /* node down */ }
  return { prefix, node: { id: node.id, host: node.host, port: node.port }, hit };
}

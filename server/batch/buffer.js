// Write-batching buffer (CLAUDE.md §9).
//
// /search does NOT write to Postgres synchronously. Instead it pushes an
// increment into this in-memory Map (query -> pendingIncrement). Repeated
// searches AGGREGATE: 50 searches of "iphone" before a flush -> { iphone: 50 }
// -> ONE upsert of +50, not 50 writes. That aggregation is the whole
// write-reduction story, and it's why /stats shows DB writes << searches.
//
// FLUSH TRIGGERS (whichever fires first, both configurable):
//   - time-based: every FLUSH_INTERVAL_MS via setInterval.
//   - size-based: when the buffer reaches FLUSH_MAX_ENTRIES distinct queries.
//
// CRASH SEMANTICS (owned, not hidden): buffered increments live in memory, so a
// crash before flush loses that window. Acceptable here — these are approximate
// search-analytics counts, not transactional data. A WAL / persisted buffer is a
// production extension, intentionally not built.
import { dbQuery } from '../db/pool.js';
import { config } from '../config.js';
import { trie } from '../trie/trie.js';

class BatchBuffer {
  constructor() {
    this.buffer = new Map(); // query -> pending increment
    this.timer = null;
    this.flushing = false;
    this.totalFlushes = 0; // number of successful DB write batches (proves writes << searches)
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.flush().catch((e) => console.error('Scheduled flush failed:', e.message));
    }, config.flushIntervalMs);
    // Don't keep the event loop alive solely for the flush timer.
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  // Record one search. Aggregates into the pending increment for that query.
  add(query, delta = 1) {
    const q = query.toLowerCase().trim();
    if (!q) return;
    this.buffer.set(q, (this.buffer.get(q) || 0) + delta);

    // Keep the in-process trie/count map live so suggestions reflect the increment
    // before the DB even hears about it (the "eventually reflected" seam).
    const current = trie.getCount(q);
    if (current === 0) trie.insert(q, delta); // brand-new query becomes suggestible now
    else trie.insert(q, current + delta);

    // Size-based trigger.
    if (this.buffer.size >= config.flushMaxEntries) {
      this.flush().catch((e) => console.error('Size-trigger flush failed:', e.message));
    }
  }

  pendingCount() {
    let total = 0;
    for (const v of this.buffer.values()) total += v;
    return total;
  }

  pendingEntries() {
    return this.buffer.size;
  }

  // Drain the buffer into ONE batched upsert. Snapshot-and-clear first so new
  // searches during the await accumulate into a fresh window (not lost).
  async flush() {
    if (this.flushing || this.buffer.size === 0) return { written: 0 };
    this.flushing = true;
    const snapshot = this.buffer;
    this.buffer = new Map();

    try {
      const entries = [...snapshot.entries()];
      const values = [];
      const params = [];
      entries.forEach(([query, delta], i) => {
        values.push(`($${i * 2 + 1}, $${i * 2 + 2})`);
        params.push(query, delta);
      });

      // ONE statement applies every aggregated increment.
      await dbQuery(
        `INSERT INTO queries (query, count) VALUES ${values.join(',')}
         ON CONFLICT (query) DO UPDATE SET count = queries.count + EXCLUDED.count`,
        params,
        'write'
      );

      this.totalFlushes++;
      return { written: entries.length };
    } catch (err) {
      // On failure, merge the snapshot back so increments aren't lost.
      for (const [q, d] of snapshot.entries()) {
        this.buffer.set(q, (this.buffer.get(q) || 0) + d);
      }
      throw err;
    } finally {
      this.flushing = false;
    }
  }
}

export const batchBuffer = new BatchBuffer();

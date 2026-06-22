// GET /stats (CLAUDE.md §12) — everything the live metrics panel shows:
// p50/p95/p99 latency, cache hit rate, DB read/write counts, buffer state, and
// trie size. The headline number is writes << searchCount (batching works).
import { Router } from 'express';
import { metrics } from '../metrics/metrics.js';
import { batchBuffer } from '../batch/buffer.js';
import { trie } from '../trie/trie.js';

export const statsRouter = Router();

statsRouter.get('/stats', (_req, res) => {
  res.json(
    metrics.snapshot({
      buffer: {
        pendingIncrements: batchBuffer.pendingCount(), // total +N waiting to flush
        pendingEntries: batchBuffer.pendingEntries(),  // distinct queries waiting
        totalFlushes: batchBuffer.totalFlushes,        // DB write batches so far
      },
      trieSize: trie.size,
    })
  );
});

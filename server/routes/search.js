// POST /search  body: { query } (CLAUDE.md §8, §11)
//
// On submit: normalize -> buffer the increment (NOT a synchronous DB write) ->
// ZINCRBY trending (decayed). New queries become suggestible immediately via the
// trie. Returns EXACTLY { "message": "Searched" } — no extra fields (spec).
import { Router } from 'express';
import { batchBuffer } from '../batch/buffer.js';
import { recordSearch } from '../trending/trending.js';
import { metrics } from '../metrics/metrics.js';

export const searchRouter = Router();

searchRouter.post('/search', async (req, res) => {
  const raw = (req.body && req.body.query) || '';
  const query = String(raw).trim().toLowerCase();

  // Empty after trim -> ignore (don't create a blank entry) but still answer.
  if (!query) return res.json({ message: 'Searched' });

  metrics.incrSearch();
  batchBuffer.add(query, 1);     // aggregates; trie/count map updated in-process
  await recordSearch(query);     // decayed trending increment (best-effort)

  res.json({ message: 'Searched' });
});

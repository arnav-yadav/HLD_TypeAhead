// GET /suggest?q=<prefix> (CLAUDE.md §6, §11)
// Returns up to 10 suggestions sorted by count desc then alpha. Empty prefix or
// no match -> 200 with []. Times the call server-side for the latency metrics.
import { Router } from 'express';
import { getSuggestions } from '../cache/suggestionCache.js';
import { metrics } from '../metrics/metrics.js';

export const suggestRouter = Router();

suggestRouter.get('/suggest', async (req, res) => {
  const start = process.hrtime.bigint();
  const q = req.query.q ?? '';
  const { prefix, suggestions } = await getSuggestions(q);
  const elapsedMs = Number(process.hrtime.bigint() - start) / 1e6;
  metrics.recordSuggestLatency(elapsedMs);
  res.json({ prefix, suggestions });
});

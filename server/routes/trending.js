// GET /trending?mode=enhanced|basic (CLAUDE.md §10, §11)
//   enhanced (default) -> recency-aware decayed ZSET ({query, score})
//   basic              -> raw all-time counts from the in-process map ({query, count})
// Both kept so the UI can show historical vs recency side by side.
import { Router } from 'express';
import { getEnhanced, getBasic } from '../trending/trending.js';
import { trie } from '../trie/trie.js';
import { config } from '../config.js';

export const trendingRouter = Router();

trendingRouter.get('/trending', async (req, res) => {
  const mode = req.query.mode === 'basic' ? 'basic' : 'enhanced';
  if (mode === 'basic') {
    return res.json({ mode, items: getBasic(trie.counts, config.trendingTopN) });
  }
  const items = await getEnhanced(config.trendingTopN);
  res.json({ mode, items });
});

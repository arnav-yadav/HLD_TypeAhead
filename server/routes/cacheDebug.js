// GET /cache/debug?prefix=<prefix> (CLAUDE.md §11)
// Shows which Redis node the consistent-hash ring routes a prefix to, and whether
// it's currently cached. Also exposes the ring's keyspace distribution so the
// virtual-node balance is demonstrable.
import { Router } from 'express';
import { debugRouting } from '../cache/suggestionCache.js';
import { ring } from '../cache/clients.js';

export const cacheDebugRouter = Router();

cacheDebugRouter.get('/cache/debug', async (req, res) => {
  const prefix = (req.query.prefix ?? '').toLowerCase().trim();
  const { node, hit } = await debugRouting(prefix);
  res.json({
    prefix,
    node,
    hit,
    ringDistribution: ring.distribution(), // fraction of keyspace each node owns
    virtualNodesPerNode: ring.virtualNodes,
  });
});

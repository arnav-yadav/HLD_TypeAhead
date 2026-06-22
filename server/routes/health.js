// GET /health (CLAUDE.md §11) — liveness: Redis nodes + Postgres reachability.
import { Router } from 'express';
import { pingAll } from '../cache/clients.js';
import { pool } from '../db/pool.js';

export const healthRouter = Router();

healthRouter.get('/health', async (_req, res) => {
  const redis = await pingAll();
  let postgres = false;
  try {
    await pool.query('SELECT 1');
    postgres = true;
  } catch { /* down */ }
  const ok = postgres && redis.some((r) => r.ok);
  res.status(ok ? 200 : 503).json({ status: ok ? 'ok' : 'degraded', redis, postgres });
});

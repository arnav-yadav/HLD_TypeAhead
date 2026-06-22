// Express app entry (CLAUDE.md §3, §15).
//
// STARTUP SEQUENCE:
//   1. Load every (query, count) row from Postgres ONCE -> build the in-memory
//      trie + query->count map. (Postgres is truth; the trie is the index.)
//   2. Seed the trending ZSET from those counts, normalized to the live scale.
//   3. Start the batch-flush timer.
//   4. Listen.
//
// TWO DECOUPLED CLOCKS (viva): the batch-flush clock keeps Postgres fresh; the
// cache-TTL clock decides when Redis re-reads truth. A flush does NOT touch Redis.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import YAML from 'yamljs';
import { config } from './config.js';
import { pool } from './db/pool.js';
import { trie } from './trie/trie.js';
import { batchBuffer } from './batch/buffer.js';
import { seedFromCounts } from './trending/trending.js';
import { disconnectAll } from './cache/clients.js';

import { suggestRouter } from './routes/suggest.js';
import { searchRouter } from './routes/search.js';
import { trendingRouter } from './routes/trending.js';
import { cacheDebugRouter } from './routes/cacheDebug.js';
import { healthRouter } from './routes/health.js';
import { statsRouter } from './routes/stats.js';

async function loadTrieFromPostgres() {
  console.log('Loading query->count rows from Postgres to build the trie...');
  const { rows } = await pool.query('SELECT query, count FROM queries');
  trie.bulkLoad(rows);
  console.log(`Trie built: ${trie.size} distinct queries indexed.`);
  if (trie.size === 0) {
    console.warn('Trie is EMPTY — did you run `npm run seed`? Suggestions will return [].');
  }
}

async function start() {
  await loadTrieFromPostgres();

  const seeded = await seedFromCounts(trie.counts);
  console.log(`Trending seeded with ${seeded} historical terms (normalized to live scale).`);

  batchBuffer.start();
  console.log(`Batch flush timer started (every ${config.flushIntervalMs}ms, or ${config.flushMaxEntries} entries).`);

  const app = express();
  app.use(cors());
  app.use(express.json());

  // Interactive API docs (Swagger UI) from the hand-written OpenAPI spec.
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const openapiSpec = YAML.load(path.join(__dirname, '..', 'docs', 'openapi.yaml'));
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(openapiSpec));

  app.use(suggestRouter);
  app.use(searchRouter);
  app.use(trendingRouter);
  app.use(cacheDebugRouter);
  app.use(healthRouter);
  app.use(statsRouter);

  app.get('/', (_req, res) => res.json({ service: 'search-typeahead', see: '/health' }));

  const server = app.listen(config.port, () => {
    console.log(`API listening on http://localhost:${config.port}`);
    console.log(`API docs (Swagger UI) at http://localhost:${config.port}/api-docs`);
  });

  // Graceful shutdown: flush the buffer so we don't drop the last window.
  const shutdown = async (sig) => {
    console.log(`\n${sig} received — flushing buffer and shutting down...`);
    batchBuffer.stop();
    try { await batchBuffer.flush(); } catch (e) { console.error('Final flush failed:', e.message); }
    server.close();
    await disconnectAll();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

start().catch((err) => {
  console.error('Server failed to start:', err);
  process.exit(1);
});

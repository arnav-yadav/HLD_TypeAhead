// Single shared pg connection pool. Also wraps query() so the metrics layer can
// count DB reads/writes — the write counter is what proves batching (writes <<
// searches) on /stats.
import pkg from 'pg';
import { config } from '../config.js';
import { metrics } from '../metrics/metrics.js';

const { Pool } = pkg;

export const pool = new Pool({
  host: config.postgres.host,
  port: config.postgres.port,
  database: config.postgres.database,
  user: config.postgres.user,
  password: config.postgres.password,
  max: 10,
});

// kind: 'read' | 'write' — drives the /stats DB counters.
export async function dbQuery(text, params, kind = 'read') {
  if (kind === 'write') metrics.incrDbWrites();
  else metrics.incrDbReads();
  return pool.query(text, params);
}

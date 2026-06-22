// Loads .env (falling back to sane defaults) and exposes a single typed config
// object. Every tunable knob from CLAUDE.md §14 is surfaced here so the rest of
// the code never reads process.env directly.
import dotenv from 'dotenv';
dotenv.config();

const num = (v, d) => (v === undefined || v === '' ? d : Number(v));

function parseRedisNodes(raw) {
  // "host:port,host:port,host:port" -> [{ id, host, port }]
  return (raw || 'localhost:6379,localhost:6380,localhost:6381')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((hostport, i) => {
      const [host, port] = hostport.split(':');
      return { id: `node${i}`, host, port: Number(port) };
    });
}

export const config = {
  postgres: {
    host: process.env.PGHOST || 'localhost',
    port: num(process.env.PGPORT, 5432),
    database: process.env.PGDATABASE || 'typeahead',
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
  },

  redisNodes: parseRedisNodes(process.env.REDIS_NODES),
  trendingNodeIndex: num(process.env.TRENDING_NODE_INDEX, 0),

  suggestTtlSeconds: num(process.env.SUGGEST_TTL_SECONDS, 600),
  ringVirtualNodes: num(process.env.RING_VIRTUAL_NODES, 150),

  trendingTauSeconds: num(process.env.TRENDING_TAU_SECONDS, 720),
  trendingTopN: num(process.env.TRENDING_TOP_N, 10),
  trendingSeedBaseline: num(process.env.TRENDING_SEED_BASELINE, 300),

  flushIntervalMs: num(process.env.FLUSH_INTERVAL_MS, 5000),
  flushMaxEntries: num(process.env.FLUSH_MAX_ENTRIES, 100),

  port: num(process.env.PORT, 4000),
};

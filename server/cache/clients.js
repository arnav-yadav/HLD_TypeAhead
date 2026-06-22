// The 3 real Redis clients + the consistent-hashing ring that routes suggestion
// keys across them. Also exposes the single designated "trending node" — the
// trending ZSET is ONE key and cannot be sharded, so it lives on one node.
import Redis from 'ioredis';
import { config } from '../config.js';
import { ConsistentHashRing } from './ring.js';

// One ioredis client per physical node, keyed by node id.
export const clients = new Map(); // nodeId -> Redis
for (const node of config.redisNodes) {
  const client = new Redis({
    host: node.host,
    port: node.port,
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  });
  client.on('error', (err) => {
    // Don't crash the process on a transient Redis blip; cache-aside degrades
    // gracefully to trie computation.
    if (process.env.NODE_ENV !== 'test') console.warn(`[redis ${node.id}] ${err.message}`);
  });
  clients.set(node.id, client);
}

export const ring = new ConsistentHashRing(config.redisNodes, config.ringVirtualNodes);

// Resolve a suggestion key -> { node, client } via the ring.
export function clientForKey(key) {
  const node = ring.getNode(key);
  return { node, client: clients.get(node.id) };
}

// The single node that holds the trending ZSET (CLAUDE.md §7: trending lives
// OUTSIDE the ring because a single key can't be partitioned).
export function trendingNode() {
  const node = config.redisNodes[config.trendingNodeIndex] || config.redisNodes[0];
  return { node, client: clients.get(node.id) };
}

export async function pingAll() {
  const results = [];
  for (const node of config.redisNodes) {
    try {
      const pong = await clients.get(node.id).ping();
      results.push({ id: node.id, host: node.host, port: node.port, ok: pong === 'PONG' });
    } catch {
      results.push({ id: node.id, host: node.host, port: node.port, ok: false });
    }
  }
  return results;
}

export async function disconnectAll() {
  for (const c of clients.values()) {
    try { await c.quit(); } catch { /* ignore */ }
  }
}

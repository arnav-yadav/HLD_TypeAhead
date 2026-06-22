// Trending — Redis ZSET with exponential time decay (CLAUDE.md §10, the +20%).
//
// WHY A ZSET: a Redis sorted set keeps members ordered by a numeric score with
// O(log n) writes (ZINCRBY) and O(log n + k) top-k reads (ZREVRANGE). The ZSET
// IS the live ranking — it's both the store and the fast read surface, so there
// is NO separate trending cache to invalidate. It auto-reorders on every write.
//
// WHY DECAY (not plain ZINCRBY 1): a plain ZSET only ever grows, so a query that
// spiked once long ago ranks forever — that's "all-time count in a fancy
// container," not trending. We make recent activity dominate WITHOUT a cleanup
// job using the standard trick:
//
//   On each search:  ZINCRBY trending  exp(t / TAU)  <query>
//
// where t = seconds since a fixed epoch and TAU = decay constant. A search NOW
// adds exp(now/TAU); an old search added exp(old/TAU), which is exponentially
// smaller — so old contributions become proportionally negligible. Decay without
// ever subtracting. TAU is set by half-life: a term searched ~TAU*ln2 seconds ago
// counts half as much as one searched now.
//
// KNOWN LIMITATION (volunteer in viva): scores grow exponentially and would
// eventually get numerically large; a long-lived system periodically rebases the
// epoch. Fine for the assignment's lifespan.
import { trendingNode } from '../cache/clients.js';
import { config } from '../config.js';

const TRENDING_KEY = 'trending:zset';

// Fixed epoch so exp(t/TAU) is comparable across the process lifetime. Captured
// once at module load (process start) — every increment is relative to this.
const EPOCH_MS = Date.now();

function decayedIncrement(nowMs = Date.now()) {
  const t = (nowMs - EPOCH_MS) / 1000; // seconds since process start
  return Math.exp(t / config.trendingTauSeconds);
}

// Called on every /search. Adds a decay-weighted increment for the query.
export async function recordSearch(query) {
  const q = query.toLowerCase().trim();
  if (!q) return;
  const { client } = trendingNode();
  try {
    await client.zincrby(TRENDING_KEY, decayedIncrement(), q);
  } catch {
    // Trending is best-effort; a Redis blip must not break /search.
  }
}

// Enhanced (recency-aware) trending: straight off the decayed ZSET.
export async function getEnhanced(n = config.trendingTopN) {
  const { client } = trendingNode();
  try {
    // ZREVRANGE ... WITHSCORES returns [member, score, member, score, ...].
    const flat = await client.zrevrange(TRENDING_KEY, 0, n - 1, 'WITHSCORES');
    const items = [];
    for (let i = 0; i < flat.length; i += 2) {
      items.push({ query: flat[i], score: Number(Number(flat[i + 1]).toFixed(2)) });
    }
    return items;
  } catch {
    return [];
  }
}

// SEEDING (CLAUDE.md §10): trending accrues decayed scores only from live
// searches, so at startup it would be EMPTY. Seed from historical all-time counts
// so popularity has a baseline — BUT normalize to the live scoring scale. Raw
// counts (up to 100000) would otherwise either swamp live activity forever or be
// instantly buried, because live increments are exp(t/TAU)-scaled (~1.0 at t=0).
//
// We map the top historical term to TRENDING_SEED_BASELINE (a few hundred) and
// scale the rest proportionally. Then live searches (~1 each, climbing with t)
// overtake mid-tier seeds within the demo window — you watch a term rise live.
export async function seedFromCounts(countsMap, topSeed = 500) {
  const { client } = trendingNode();
  // Take the strongest historical terms; seeding the entire 100k is pointless.
  const top = [...countsMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topSeed);
  if (top.length === 0) return 0;

  const maxCount = top[0][1];
  const baseline = config.trendingSeedBaseline;

  try {
    await client.del(TRENDING_KEY); // fresh seed each startup
    const pipeline = client.pipeline();
    for (const [query, count] of top) {
      const score = (count / maxCount) * baseline; // top term -> baseline, rest proportional
      pipeline.zadd(TRENDING_KEY, score, query);
    }
    await pipeline.exec();
    return top.length;
  } catch {
    return 0;
  }
}

// BASIC ranking (CLAUDE.md §10): raw all-time count, straight from the in-process
// count map. Represents historical popularity — kept so the UI can show
// basic-vs-enhanced side by side.
export function getBasic(countsMap, n = config.trendingTopN) {
  return [...countsMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([query, count]) => ({ query, count }));
}

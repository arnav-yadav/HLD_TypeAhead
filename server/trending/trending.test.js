// Unit tests for trending (server/trending/trending.js).
// PLACEMENT: put this file at  server/trending/trending.test.js  (co-located),
// so the vi.mock paths below ('../cache/clients.js', '../config.js') resolve to
// the SAME modules that trending.js imports.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Build the mock handles first. vi.hoisted runs before the (hoisted) vi.mock
// factories, so the factories can safely reference these spies.
const h = vi.hoisted(() => {
  const zincrby = vi.fn().mockResolvedValue(1);
  const zrevrange = vi.fn();
  const del = vi.fn().mockResolvedValue(1);
  const zaddP = vi.fn();                 // pipeline.zadd
  const exec = vi.fn().mockResolvedValue([]);
  const pipeline = vi.fn(() => ({ zadd: zaddP, exec }));
  return { zincrby, zrevrange, del, zaddP, exec, pipeline };
});

vi.mock('../cache/clients.js', () => ({
  trendingNode: () => ({
    client: {
      zincrby: h.zincrby,
      zrevrange: h.zrevrange,
      del: h.del,
      pipeline: h.pipeline,
    },
  }),
}));

vi.mock('../config.js', () => ({
  config: { trendingTauSeconds: 720, trendingTopN: 10, trendingSeedBaseline: 300 },
}));

// Import AFTER the mocks are registered.
import { getBasic, recordSearch, getEnhanced, seedFromCounts } from './trending.js';

beforeEach(() => { vi.clearAllMocks(); });

describe('trending — getBasic (pure, all-time count)', () => {
  it('sorts by count desc and limits to n', () => {
    const counts = new Map([['a', 10], ['b', 99], ['c', 50]]);
    expect(getBasic(counts, 2)).toEqual([
      { query: 'b', count: 99 },
      { query: 'c', count: 50 },
    ]);
  });
});

describe('trending — recordSearch', () => {
  it('ignores empty / whitespace queries', async () => {
    await recordSearch('   ');
    expect(h.zincrby).not.toHaveBeenCalled();
  });

  it('increments with a positive, finite decayed score for a normalized query', async () => {
    await recordSearch('  IPhone ');
    expect(h.zincrby).toHaveBeenCalledTimes(1);
    const [, score, member] = h.zincrby.mock.calls[0];
    expect(member).toBe('iphone');            // lowercased + trimmed
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBeGreaterThan(0);         // exp(t/TAU) >= ~1 at t>=0
  });

  it('never throws even if Redis rejects (best-effort)', async () => {
    h.zincrby.mockRejectedValueOnce(new Error('redis down'));
    await expect(recordSearch('iphone')).resolves.toBeUndefined();
  });
});

describe('trending — getEnhanced', () => {
  it('parses ZREVRANGE WITHSCORES flat output into {query, score}', async () => {
    h.zrevrange.mockResolvedValueOnce(['google', '300', 'yahoo', '150.5']);
    expect(await getEnhanced(2)).toEqual([
      { query: 'google', score: 300 },
      { query: 'yahoo', score: 150.5 },
    ]);
  });

  it('returns [] when Redis errors', async () => {
    h.zrevrange.mockRejectedValueOnce(new Error('redis down'));
    expect(await getEnhanced(5)).toEqual([]);
  });
});

describe('trending — seedFromCounts (normalized to the live scale)', () => {
  it('maps the top historical term to the baseline and scales the rest proportionally', async () => {
    const counts = new Map([['iphone', 100000], ['python', 50000], ['java', 25000]]);
    const seeded = await seedFromCounts(counts);

    expect(seeded).toBe(3);
    expect(h.del).toHaveBeenCalledTimes(1);   // fresh seed each startup
    expect(h.zaddP).toHaveBeenCalledTimes(3);
    expect(h.exec).toHaveBeenCalledTimes(1);

    const byQuery = Object.fromEntries(
      h.zaddP.mock.calls.map(([, score, q]) => [q, score]),
    );
    expect(byQuery.iphone).toBeCloseTo(300, 5); // top -> baseline
    expect(byQuery.python).toBeCloseTo(150, 5); // 50% -> 150
    expect(byQuery.java).toBeCloseTo(75, 5);    // 25% -> 75
  });

  it('returns 0 and does not touch Redis for an empty map', async () => {
    expect(await seedFromCounts(new Map())).toBe(0);
    expect(h.del).not.toHaveBeenCalled();
  });
});

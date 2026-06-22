// Unit tests for the consistent-hash ring (server/cache/ring.js).
// PLACEMENT: put this file at  server/cache/ring.test.js  (co-located with ring.js).
import { describe, it, expect } from 'vitest';
import { ConsistentHashRing } from './ring.js';

const NODES = [
  { id: 'n0', host: 'localhost', port: 6379 },
  { id: 'n1', host: 'localhost', port: 6380 },
  { id: 'n2', host: 'localhost', port: 6381 },
];
const IDS = NODES.map((n) => n.id);

describe('ConsistentHashRing — routing', () => {
  it('returns null when the ring is empty', () => {
    expect(new ConsistentHashRing([], 150).getNode('anything')).toBeNull();
  });

  it('routes a key to one of the configured nodes', () => {
    const ring = new ConsistentHashRing(NODES, 150);
    expect(IDS).toContain(ring.getNode('suggest:iph').id);
  });

  it('is deterministic — same key always routes to the same node', () => {
    const ring = new ConsistentHashRing(NODES, 150);
    const first = ring.getNode('suggest:samsung').id;
    for (let i = 0; i < 50; i++) {
      expect(ring.getNode('suggest:samsung').id).toBe(first);
    }
  });
});

describe('ConsistentHashRing — distribution (virtual nodes balance the ring)', () => {
  it('owns a near-even fraction of the keyspace per node, summing to ~1', () => {
    const dist = new ConsistentHashRing(NODES, 150).distribution();
    const fracs = Object.values(dist);
    const sum = fracs.reduce((a, b) => a + b, 0);
    expect(sum).toBeGreaterThan(0.99);
    expect(sum).toBeLessThan(1.01);
    for (const f of fracs) {
      expect(f).toBeGreaterThan(0.2); // none starved
      expect(f).toBeLessThan(0.5);    // none hot-spotting
    }
  });

  it('empirically routes a fair share of random keys to each node', () => {
    const ring = new ConsistentHashRing(NODES, 150);
    const counts = { n0: 0, n1: 0, n2: 0 };
    for (let i = 0; i < 3000; i++) counts[ring.getNode('key:' + i).id]++;
    for (const id of IDS) expect(counts[id] / 3000).toBeGreaterThan(0.2);
  });

  it('is lumpier with a single virtual node (shows why we use ~150)', () => {
    // Not an assertion on exact values — just confirms the knob exists and runs.
    const lumpy = new ConsistentHashRing(NODES, 1).distribution();
    expect(Object.keys(lumpy).length).toBe(3);
  });
});

describe('ConsistentHashRing — minimal remapping (the core guarantee)', () => {
  it('moves ONLY the removed node\'s keys; every other key stays put', () => {
    const ring = new ConsistentHashRing(NODES, 150);
    const keys = Array.from({ length: 4000 }, (_, i) => 'suggest:k' + i);
    const before = new Map(keys.map((k) => [k, ring.getNode(k).id]));

    ring.removeNode('n1');

    let moved = 0;
    for (const k of keys) {
      const now = ring.getNode(k).id;
      expect(now).not.toBe('n1'); // n1 owns nothing after removal
      if (before.get(k) === 'n1') {
        moved++; // expected to move to a neighbour
      } else {
        // INVARIANT: a key whose owner was not removed must never move.
        expect(now).toBe(before.get(k));
      }
    }
    // Only ~1/3 should move — nowhere near the "almost all" of hash % N.
    expect(moved / keys.length).toBeLessThan(0.5);
    expect(moved).toBeGreaterThan(0);
  });
});

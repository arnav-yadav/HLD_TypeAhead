// Unit tests for the in-memory Trie (server/trie/trie.js).
// PLACEMENT: put this file at  server/trie/trie.test.js  (co-located with trie.js).
import { describe, it, expect, beforeEach } from 'vitest';
import { Trie } from './trie.js';

describe('Trie — insert & counts', () => {
  let t;
  beforeEach(() => { t = new Trie(); });

  it('inserts and reads back a count', () => {
    t.insert('iphone', 100);
    expect(t.getCount('iphone')).toBe(100);
  });

  it('normalizes case and whitespace on insert and lookup', () => {
    t.insert('  IPhone  ', 42);
    expect(t.getCount('iphone')).toBe(42);
    expect(t.getCount('IPHONE')).toBe(42);
  });

  it('ignores empty / whitespace-only queries', () => {
    t.insert('   ', 5);
    expect(t.size).toBe(0);
  });

  it('tracks distinct size; re-insert updates count without growing size', () => {
    t.insert('a', 1);
    t.insert('b', 1);
    expect(t.size).toBe(2);
    t.insert('a', 99);
    expect(t.size).toBe(2);
    expect(t.getCount('a')).toBe(99);
  });

  it('bulkLoad coerces string counts to numbers', () => {
    t.bulkLoad([{ query: 'x', count: '7' }, { query: 'y', count: 3 }]);
    expect(t.getCount('x')).toBe(7);
    expect(t.size).toBe(2);
  });

  it('returns 0 for an unknown query', () => {
    expect(t.getCount('nope')).toBe(0);
  });
});

describe('Trie — bumpNew (new query becomes suggestible)', () => {
  let t;
  beforeEach(() => { t = new Trie(); });

  it('inserts a brand-new query at count 1 and returns true', () => {
    expect(t.bumpNew('newquery')).toBe(true);
    expect(t.getCount('newquery')).toBe(1);
    expect(t.size).toBe(1);
  });

  it('does not touch an existing query and returns false', () => {
    t.insert('exists', 50);
    expect(t.bumpNew('exists')).toBe(false);
    expect(t.getCount('exists')).toBe(50);
  });
});

describe('Trie — topK prefix search', () => {
  let t;
  beforeEach(() => {
    t = new Trie();
    t.insert('app', 100);
    t.insert('apple', 100);
    t.insert('apply', 50);
    t.insert('apricot', 100);
    t.insert('banana', 999); // outside the "ap" prefix on purpose
  });

  it('returns only queries matching the prefix', () => {
    const r = t.topK('ap', 10).map((x) => x.query);
    expect(r).not.toContain('banana');
    for (const q of r) expect(q.startsWith('ap')).toBe(true);
  });

  it('sorts by count desc, then alphabetical for ties', () => {
    // counts: app=100, apple=100, apricot=100 (tie -> alpha), then apply=50
    expect(t.topK('ap', 10).map((x) => x.query))
      .toEqual(['app', 'apple', 'apricot', 'apply']);
  });

  it('respects the k limit', () => {
    expect(t.topK('ap', 2).map((x) => x.query)).toEqual(['app', 'apple']);
  });

  it('includes a prefix that is itself a complete word', () => {
    expect(t.topK('app', 10).map((x) => x.query)).toContain('app');
  });

  it('returns [] for an empty prefix', () => {
    expect(t.topK('', 10)).toEqual([]);
  });

  it('returns [] for a non-existent prefix', () => {
    expect(t.topK('zzz', 10)).toEqual([]);
  });

  it('is case-insensitive on the prefix', () => {
    expect(t.topK('AP', 10).map((x) => x.query))
      .toEqual(t.topK('ap', 10).map((x) => x.query));
  });

  it('attaches the correct count to each suggestion', () => {
    const apple = t.topK('appl', 10).find((x) => x.query === 'apple');
    expect(apple.count).toBe(100);
  });
});

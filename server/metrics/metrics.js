// In-process instrumentation (CLAUDE.md §12). All counters live in memory and are
// surfaced via GET /stats so the demo can show p95 latency, cache hit rate, and
// — most importantly — that DB writes are far fewer than searches (batching works).

const MAX_SAMPLES = 1000; // rolling window of recent /suggest latencies (ms)

class Metrics {
  constructor() {
    this.suggestLatencies = []; // rolling array, newest pushed, capped at MAX_SAMPLES
    this.cacheHits = 0;
    this.cacheMisses = 0;
    this.dbReads = 0;
    this.dbWrites = 0;
    this.searchCount = 0; // total /search requests accepted
  }

  recordSuggestLatency(ms) {
    this.suggestLatencies.push(ms);
    if (this.suggestLatencies.length > MAX_SAMPLES) this.suggestLatencies.shift();
  }

  incrCacheHit() { this.cacheHits++; }
  incrCacheMiss() { this.cacheMisses++; }
  incrDbReads() { this.dbReads++; }
  incrDbWrites() { this.dbWrites++; }
  incrSearch() { this.searchCount++; }

  percentile(p) {
    const arr = this.suggestLatencies;
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return Number(sorted[idx].toFixed(2));
  }

  snapshot(extra = {}) {
    const total = this.cacheHits + this.cacheMisses;
    return {
      latencyMs: {
        p50: this.percentile(50),
        p95: this.percentile(95),
        p99: this.percentile(99),
        samples: this.suggestLatencies.length,
      },
      cache: {
        hits: this.cacheHits,
        misses: this.cacheMisses,
        hitRate: total === 0 ? 0 : Number((this.cacheHits / total).toFixed(4)),
      },
      db: {
        reads: this.dbReads,
        writes: this.dbWrites, // << searchCount when batching works
      },
      searchCount: this.searchCount,
      ...extra,
    };
  }
}

export const metrics = new Metrics();

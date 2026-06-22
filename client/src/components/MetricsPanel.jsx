import { useEffect, useState } from 'react';
import { fetchStats } from '../lib/api.js';

// Live /stats panel (CLAUDE.md §12). The headline is writes << searches (batching
// works), shown alongside p95 latency and cache hit rate so the demo doesn't curl.
function Stat({ label, value, sub, accent }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/50 p-4">
      <div className="text-xs uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent || 'text-slate-100'}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export default function MetricsPanel({ refreshKey }) {
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const data = await fetchStats();
        if (alive) { setStats(data); setError(null); }
      } catch {
        if (alive) setError('Could not load /stats');
      }
    };
    load();
    const id = setInterval(load, 2000); // live-ish refresh
    return () => { alive = false; clearInterval(id); };
  }, [refreshKey]);

  if (error) return <p className="text-sm text-rose-400">{error}</p>;
  if (!stats) return <p className="text-sm text-slate-500">Loading metrics…</p>;

  const hitPct = (stats.cache.hitRate * 100).toFixed(1);
  const reduction = stats.db.writes > 0 ? Math.round(stats.searchCount / stats.db.writes) : null;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      <Stat label="p95 latency" value={`${stats.latencyMs.p95} ms`} sub={`p50 ${stats.latencyMs.p50} · p99 ${stats.latencyMs.p99}`} accent="text-emerald-400" />
      <Stat label="cache hit rate" value={`${hitPct}%`} sub={`${stats.cache.hits} hits · ${stats.cache.misses} miss`} accent="text-sky-400" />
      <Stat label="trie size" value={stats.trieSize.toLocaleString()} sub="distinct queries indexed" />
      <Stat label="searches" value={stats.searchCount.toLocaleString()} sub="POST /search accepted" />
      <Stat
        label="DB writes"
        value={stats.db.writes.toLocaleString()}
        sub={reduction ? `~${reduction}× fewer than searches` : 'batched upserts'}
        accent="text-amber-400"
      />
      <Stat
        label="buffer pending"
        value={stats.buffer.pendingIncrements.toLocaleString()}
        sub={`${stats.buffer.pendingEntries} entries · ${stats.buffer.totalFlushes} flushes`}
      />
    </div>
  );
}

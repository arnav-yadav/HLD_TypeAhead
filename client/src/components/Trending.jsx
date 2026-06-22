import { useEffect, useState, useCallback } from 'react';
import { fetchTrending, formatCompact } from '../lib/api.js';

// Trending list with a basic<->enhanced toggle (CLAUDE.md §10/§13).
//   enhanced = recency-aware decayed ZSET (shows a `score`)
//   basic    = raw all-time count (shows a `count`)
// `refreshKey` bumps from the parent after a search so the live list updates.
export default function Trending({ refreshKey }) {
  const [mode, setMode] = useState('enhanced');
  const [items, setItems] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await fetchTrending(mode);
      setItems(data.items || []);
      setError(null);
    } catch {
      setError('Could not load trending');
    }
  }, [mode]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Light polling so decay/order shifts are visible during the demo.
  useEffect(() => {
    const id = setInterval(load, 4000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-900/50 p-5">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-400">Trending</h2>
        <div className="flex rounded-lg border border-slate-700 p-0.5 text-xs">
          {['enhanced', 'basic'].map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              className={`rounded-md px-3 py-1 capitalize transition-colors ${
                mode === m ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <p className="mb-3 text-xs text-slate-500">
        {mode === 'enhanced'
          ? 'Recency-aware: time-decayed ZSET. Recent searches climb.'
          : 'Historical: raw all-time counts. Static popularity.'}
      </p>

      {error && <p className="text-sm text-rose-400">{error}</p>}

      {!error && items.length === 0 && <p className="text-sm text-slate-500">No data yet.</p>}

      <ol className="space-y-1.5">
        {items.map((it, i) => (
          <li key={it.query} className="flex items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-slate-800/50">
            <span className="w-5 text-right text-xs font-mono text-slate-500">{i + 1}</span>
            <span className="flex-1 truncate text-slate-200">{it.query}</span>
            <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
              {mode === 'enhanced' ? it.score?.toFixed?.(1) : formatCompact(it.count)}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

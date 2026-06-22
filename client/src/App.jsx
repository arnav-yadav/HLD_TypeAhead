import { useState } from 'react';
import SearchBox from './components/SearchBox.jsx';
import Trending from './components/Trending.jsx';
import MetricsPanel from './components/MetricsPanel.jsx';

export default function App() {
  // Bumped after each submitted search so Trending + Metrics refresh promptly.
  const [refreshKey, setRefreshKey] = useState(0);
  const [lastSearched, setLastSearched] = useState(null);

  const onSearched = (q) => {
    setLastSearched(q);
    setRefreshKey((k) => k + 1);
  };

  return (
    <div className="mx-auto min-h-screen max-w-5xl px-5 py-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Search Typeahead</h1>
        <p className="mt-1 text-slate-400">
          Trie suggestions · consistent-hashed Redis cache · decayed trending · batched writes
        </p>
      </header>

      <section className="mb-10">
        <SearchBox onSearched={onSearched} />
        {lastSearched && (
          <p className="mt-3 text-sm text-emerald-400">
            Searched “{lastSearched}” — count buffered, trending bumped.
          </p>
        )}
      </section>

      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <section>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Live Metrics
          </h2>
          <MetricsPanel refreshKey={refreshKey} />
          <p className="mt-4 text-xs text-slate-600">
            Watch <span className="text-amber-400">DB writes</span> stay far below{' '}
            <span className="text-slate-300">searches</span> as you load test — that gap is the
            batching win.
          </p>
        </section>

        <aside>
          <Trending refreshKey={refreshKey} />
        </aside>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from 'react';
import { fetchSuggestions, submitSearch } from '../lib/api.js';
import Suggestions from './Suggestions.jsx';

const DEBOUNCE_MS = 300; // CLAUDE.md §13: industry-standard; cuts backend calls without feeling laggy.

// The search input: debounced /suggest calls, a live dropdown, keyboard
// navigation (arrows + Enter), and submitting a search via /search.
export default function SearchBox({ onSearched }) {
  const [value, setValue] = useState('');
  const [items, setItems] = useState([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const abortRef = useRef(null);

  // Debounced suggestion fetch. Aborts the in-flight request on each keystroke so
  // only the latest prefix's response lands.
  useEffect(() => {
    const prefix = value.trim();
    if (!prefix) { setItems([]); setActiveIndex(-1); setError(null); return; }

    const t = setTimeout(async () => {
      if (abortRef.current) abortRef.current.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setLoading(true);
      setError(null);
      try {
        const data = await fetchSuggestions(prefix, ctrl.signal);
        setItems(data.suggestions || []);
        setActiveIndex(-1);
        setOpen(true);
      } catch (e) {
        if (e.name !== 'AbortError') setError('Could not load suggestions');
      } finally {
        setLoading(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(t);
  }, [value]);

  async function doSearch(q) {
    const query = (q ?? value).trim();
    if (!query) return;
    setValue(query);
    setOpen(false);
    setItems([]);
    try {
      await submitSearch(query);
      onSearched?.(query);
    } catch {
      setError('Search submission failed');
    }
  }

  function onKeyDown(e) {
    if (!open || items.length === 0) {
      if (e.key === 'Enter') doSearch();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % items.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + items.length) % items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      doSearch(activeIndex >= 0 ? items[activeIndex].query : value);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div className="relative w-full">
      <div className="relative">
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => items.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 120)}
          placeholder="Search… (try: iph, sam, mac)"
          className="w-full rounded-xl border border-slate-700 bg-slate-900 px-4 py-3.5 text-lg text-slate-100 placeholder-slate-500 outline-none ring-indigo-500/40 focus:border-indigo-500 focus:ring-2"
          autoComplete="off"
          spellCheck="false"
        />
        {loading && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-slate-500">…</span>
        )}
      </div>

      {open && <Suggestions items={items} activeIndex={activeIndex} onSelect={doSearch} />}

      {error && <p className="mt-2 text-sm text-rose-400">{error}</p>}
    </div>
  );
}

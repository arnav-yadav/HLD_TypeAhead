import { formatCompact } from '../lib/api.js';

// Dropdown of suggestions. Hidden by the parent when the list is empty
// (CLAUDE.md §6: empty array -> hide dropdown). `activeIndex` drives keyboard
// highlight; clicking or Enter selects.
export default function Suggestions({ items, activeIndex, onSelect }) {
  if (!items || items.length === 0) return null;
  return (
    <ul className="absolute z-10 mt-2 w-full overflow-hidden rounded-xl border border-slate-700 bg-slate-900 shadow-2xl">
      {items.map((s, i) => (
        <li key={s.query}>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onSelect(s.query); }}
            className={`flex w-full items-center justify-between px-4 py-2.5 text-left transition-colors ${
              i === activeIndex ? 'bg-indigo-600/30' : 'hover:bg-slate-800'
            }`}
          >
            <span className="truncate text-slate-100">{s.query}</span>
            <span className="ml-3 shrink-0 rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">
              {formatCompact(s.count)}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

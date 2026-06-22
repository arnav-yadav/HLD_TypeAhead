// Thin API client. All calls go through Vite's /api proxy -> Express (see
// vite.config.js), so no CORS handling is needed in dev.
const BASE = '/api';

export async function fetchSuggestions(prefix, signal) {
  const res = await fetch(`${BASE}/suggest?q=${encodeURIComponent(prefix)}`, { signal });
  if (!res.ok) throw new Error(`suggest failed: ${res.status}`);
  return res.json(); // { prefix, suggestions: [{query, count}] }
}

export async function submitSearch(query) {
  const res = await fetch(`${BASE}/search`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`search failed: ${res.status}`);
  return res.json(); // { message: "Searched" }
}

export async function fetchTrending(mode = 'enhanced') {
  const res = await fetch(`${BASE}/trending?mode=${mode}`);
  if (!res.ok) throw new Error(`trending failed: ${res.status}`);
  return res.json(); // { mode, items: [...] }
}

export async function fetchStats() {
  const res = await fetch(`${BASE}/stats`);
  if (!res.ok) throw new Error(`stats failed: ${res.status}`);
  return res.json();
}

// 88000 -> "88k", 1100 -> "1.1k". Used for the rounded count labels.
export function formatCompact(n) {
  if (n == null) return '';
  if (n < 1000) return String(n);
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}k`;
  }
  const v = n / 1_000_000;
  return `${v >= 10 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, '')}M`;
}

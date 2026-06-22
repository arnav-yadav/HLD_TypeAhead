// Drives traffic at the running server to exercise the whole system for the demo:
//   - fires /suggest for prefixes (populates latency + cache hit/miss metrics)
//   - fires /search weighted toward a few "hot" terms so trending visibly moves
//     and the batch buffer aggregates (proving DB writes << searches)
//
// Usage:  node scripts/loadtest.js  [--searches=2000] [--suggests=1000] [--base=http://localhost:4000]
import process from 'node:process';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  })
);

const BASE = args.base || 'http://localhost:4000';
const NUM_SEARCHES = Number(args.searches || 2000);
const NUM_SUGGESTS = Number(args.suggests || 1000);

// A few hot terms get most of the search weight so trending clearly rises and the
// buffer aggregates many increments per distinct query (the batching story).
const HOT = ['iphone', 'samsung galaxy', 'macbook', 'airpods', 'playstation 5'];
const PREFIXES = ['ip', 'iph', 'sam', 'mac', 'air', 'pla', 'lap', 'head', 'tv', 'nin'];

function pickWeighted() {
  // 70% chance to pick a hot term, else a random-ish tail term.
  if (Math.random() < 0.7) return HOT[Math.floor(Math.random() * HOT.length)];
  const tail = ['nintendo switch', 'kindle', 'roku', 'fitbit', 'gopro', 'echo dot'];
  return tail[Math.floor(Math.random() * tail.length)];
}

async function post(path, body) {
  try {
    await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (e) { /* ignore transient */ }
}

async function get(path) {
  try { await fetch(`${BASE}${path}`); } catch (e) { /* ignore */ }
}

async function main() {
  console.log(`Load test against ${BASE}`);
  console.log(`-> ${NUM_SUGGESTS} suggests, ${NUM_SEARCHES} searches (weighted to hot terms)`);

  // Suggests first (repeated prefixes drive cache HITs after the first MISS).
  const suggestTasks = [];
  for (let i = 0; i < NUM_SUGGESTS; i++) {
    const p = PREFIXES[i % PREFIXES.length];
    suggestTasks.push(get(`/suggest?q=${encodeURIComponent(p)}`));
    if (suggestTasks.length >= 50) { await Promise.all(suggestTasks.splice(0)); }
  }
  await Promise.all(suggestTasks);

  // Searches (weighted) drive trending + batch buffer.
  const searchTasks = [];
  for (let i = 0; i < NUM_SEARCHES; i++) {
    searchTasks.push(post('/search', { query: pickWeighted() }));
    if (searchTasks.length >= 50) { await Promise.all(searchTasks.splice(0)); }
  }
  await Promise.all(searchTasks);

  // Print the resulting stats so the write-reduction is visible from the CLI too.
  try {
    const stats = await (await fetch(`${BASE}/stats`)).json();
    console.log('\n--- /stats after load ---');
    console.log(`p95 latency:      ${stats.latencyMs.p95} ms`);
    console.log(`cache hit rate:   ${(stats.cache.hitRate * 100).toFixed(1)}%  (${stats.cache.hits} hits / ${stats.cache.misses} misses)`);
    console.log(`searches:         ${stats.searchCount}`);
    console.log(`DB writes:        ${stats.db.writes}  <-- should be MUCH smaller than searches`);
    console.log(`buffer pending:   ${stats.buffer.pendingIncrements} increments / ${stats.buffer.pendingEntries} entries`);
    const ratio = stats.db.writes > 0 ? (stats.searchCount / stats.db.writes).toFixed(0) : '∞';
    console.log(`write reduction:  ~${ratio}x fewer DB writes than searches`);
  } catch (e) {
    console.error('Could not fetch /stats:', e.message);
  }
}

main();

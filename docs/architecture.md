# Architecture & Design Rationale

This is a **design-first** build. Every component below comes with *why* it was
chosen and *what it trades off* — the assignment is graded partly on a viva where
each major decision must be defended.

---

## 1. System diagram

```
                    ┌──────────────────────────────┐
   Browser (React)  │  Search box + suggestions     │
   debounce 300ms   │  dropdown + trending + stats  │
                    └───────────────┬───────────────┘
                                    │ HTTP (JSON)
                    ┌───────────────▼───────────────┐
                    │        Express API server      │
                    │                                │
   GET /suggest ───▶│  cache-aside read path         │
                    │   1. hash prefix → ring → node  │───▶ Redis node (suggest:* keys)
                    │   2. HIT → return                │      (one of 3, by consistent hash)
                    │   3. MISS → trie compute,        │
                    │      return, back-fill cache     │
                    │                                  │
   POST /search ───▶│  - increment buffer (Map)        │
                    │  - ZINCRBY trending (decayed)    │───▶ Redis node 0 (trending ZSET)
                    │  - return {message:"Searched"}   │
                    │                                  │
   batch flush  ───▶│  buffer → Postgres upsert        │───▶ PostgreSQL (source of truth)
   (timer/size)     │                                  │
                    │  Trie (in-memory) ◀──────────────│◀─── loaded from Postgres at startup
                    └──────────────────────────────────┘
```

### Two decoupled clocks (important)
- **Batch-flush clock** keeps *Postgres* fresh (writes buffered increments).
- **Cache-TTL clock** decides when *Redis* re-reads truth.

A flush updating Postgres does **not** touch Redis; only TTL expiry pulls fresh
data into the suggestion cache. They are independent by design.

---

## 2. Tech stack & why

| Layer | Choice | Why |
|---|---|---|
| Backend | Node.js + Express | I/O-bound workload; the event loop handles concurrent suggestion reads well, and async batching/flushing fits the "don't block the loop on writes" narrative. |
| Primary store | PostgreSQL | Durable truth for `query→count`; survives restarts; clean batched upserts. |
| Cache | Redis ×3 | In-memory suggestion + trending store. Three real instances demonstrate consistent-hashing routing/partitioning. |
| In-memory index | Trie | Built from Postgres at startup; O(L) prefix queries independent of dataset size. |
| Frontend | React + Vite + Tailwind | Interaction feel (live dropdown, debounce) is where the UI polish lives; React's state model + Vite + Tailwind get there fast. |
| Orchestration | Docker Compose | One command brings up 3 Redis + Postgres locally. |

---

## 3. Suggestions — the Trie

**Why a trie.** Walking a prefix is **O(L)** in the prefix *length* — independent
of how many queries exist. Typing `iph` is the same 3-hop walk at 100k rows or
10M. This beats:
- scanning the `query→count` map every keystroke — **O(N)** per stroke; and
- precomputing a `prefix→top10` map — memory explosion + painful updates.

**Top-k on miss.** The trie computes the top-10 on a **cache miss** by a bounded
traversal of the matched subtree (the subtree is bounded by the number of
completions of the prefix, not the dataset). We deliberately do **not** cache a
top-k list on every node — instead **Redis caches the computed
`prefix→suggestions`**. So: trie computes on miss, Redis serves hits. This is the
controlled version of "precompute prefixes" without unbounded memory.

**Sort.** Count descending, ties alphabetical — deterministic. **No recency
here**; recency belongs to trending, so the basic-vs-enhanced comparison stays
clean.

---

## 4. Caching — cache-aside + consistent hashing

**Cache-aside (lazy loading).** On a miss we compute from the trie, return to the
user, *and* back-fill the routed Redis node. The user **always** gets an answer; a
miss is merely slower, never empty. Chosen over push/precompute because the spec
wants fallback semantics and cache-aside needs far less machinery.

**What's cached.** Key `suggest:<prefix>` → JSON list of `{query, count}` where
`count` is a **rounded snapshot**. Exact live counts are *not* cached, so a count
ticking 88000→88003 never churns the cache (the order didn't change).

**Invalidation — TTL only.** Suggestion keys are written with a TTL (default
600s). Orderings are stable (top-k rarely swaps under small count changes), so we
favor hit rate and accept ≤ TTL staleness on ordering. Explicit
invalidation-on-write is a production extension, not built — the batch clock and
TTL clock are decoupled on purpose.

### Consistent hashing
- **3 real Redis instances** (ports 6379/6380/6381); the app holds 3 clients.
- A **ring** maps each `suggest:<prefix>` key to one node by hashing the key
  (MD5 truncated to 32 bits) and walking clockwise to the next node point.
- **~150 virtual nodes per physical node.** Without them, 3 random ring points can
  carve very uneven arcs → one node owns a huge share (hot-spotting). 150 virtual
  points per node smooth arc sizes toward uniform. `GET /cache/debug` exposes the
  resulting keyspace distribution as proof.
- **Why not `hash % N`.** With modulo, changing N remaps *almost every* key. With
  the ring, removing a node moves only the keys in *that node's arcs* — about
  **1/N** of keys — to their next clockwise neighbors. We explain node-failure
  remapping verbally rather than scripting a container-kill.

**Honest framing.** 3 Redis on one machine demonstrate real **routing and
partitioning**, not throughput scaling (one box, one CPU).

**Trending lives outside the ring.** The ring distributes `suggest:*` keys. The
trending ZSET is a **single key**, so it cannot be partitioned — it lives on one
designated node (node 0). "Consistent hashing distributes everything" is not quite
true; it distributes the *suggestion cache*.

---

## 5. Search submission & batch writes

`POST /search` does **not** write to Postgres synchronously. It:
1. normalizes the query,
2. pushes a `+1` into an in-memory **Map buffer** (`query → pendingIncrement`),
3. `ZINCRBY`s the decayed trending ZSET,
4. inserts brand-new queries into the trie so they're instantly suggestible,
5. returns `{ "message": "Searched" }`.

The spec word "**eventually**" reflected is what *permits* buffering.

### Batching (write reduction)
- Repeated searches **aggregate**: 50 searches of "iphone" before a flush →
  `{iphone: 50}` → **one** upsert of `+50`, not 50 writes.
- **Dual flush triggers** (whichever fires first): time-based
  (`FLUSH_INTERVAL_MS`, default 5s) and size-based (`FLUSH_MAX_ENTRIES`, default
  100 distinct entries).
- Flush is **one** statement:
  ```sql
  INSERT INTO queries (query, count) VALUES ($1,$2), ... 
  ON CONFLICT (query) DO UPDATE SET count = queries.count + EXCLUDED.count;
  ```
- `/stats` exposes buffer state + DB write count so you can show
  *N buffered → trigger fires → write counter +1*, proving **writes ≪ searches**.

### Crash semantics (owned)
Buffered increments live in memory, so a crash before flush loses that window.
**Acceptable** here — these are approximate search-analytics counts, not
transactional data. A WAL / persisted buffer is a production extension, not built.
(The server also flushes on `SIGINT`/`SIGTERM` for clean shutdowns.)

---

## 6. Trending — Redis ZSET with time decay (the +20%)

**Why a ZSET.** A sorted set keeps members ordered by score with O(log n) writes
(`ZINCRBY`) and O(log n + k) reads (`ZREVRANGE`). The ZSET **is** the live ranking
— store and read surface in one — so there is **no separate trending cache to
invalidate**.

**Why decay.** A plain `ZINCRBY 1` only ever grows scores, so a one-time old spike
ranks forever — "all-time count in a fancy container," not trending. We make
recent activity dominate without a cleanup job:

```
On each search:  ZINCRBY trending  exp(t / TAU)  <query>
```

where `t` = seconds since a fixed epoch, `TAU` = decay constant. A search *now*
adds `exp(now/TAU)`; an old search added an exponentially smaller value, so old
contributions become proportionally negligible — **decay without ever
subtracting**. τ is set by half-life (default ~12 min): activity from ~τ·ln2 ago
counts half as much as now.

**Known limitation (volunteer it).** Scores grow exponentially and would
eventually get numerically large; a long-lived system periodically rebases the
epoch. Fine for the assignment's lifespan.

**Seeding at startup.** Trending accrues decayed scores only from live searches,
so it would start **empty**. We seed from historical counts — but **normalized** to
the live scale: raw counts (up to 100000) would either swamp live activity forever
or be instantly buried, since live increments are `exp(t/TAU)`-scaled (~1.0 at
t=0). So the top historical term maps to a baseline (~300) and the rest scale
proportionally; live searches then climb past mid-tier seeds within the demo
window — you watch a term overtake its historical peers live. Spotting this
scale mismatch *is* the design point of seeding.

**Basic vs enhanced.** Basic = raw all-time count (historical popularity).
Enhanced = decayed ZSET (recency-aware). Both are exposed so the difference is
demonstrable side by side (`/trending?mode=basic|enhanced`).

---

## 7. Instrumentation

`/stats` captures, in memory:
- **Latency** — each `/suggest` timed server-side; rolling window → p50/p95/p99.
- **Cache hit rate** — `hits / (hits + misses)` on the cache-aside path.
- **DB read/write counts** — the write counter proves batching.
- **Buffer state** — pending increments + distinct entries + total flushes.

The React metrics panel polls `/stats` so the demo shows p95, hit rate, and
writes-vs-searches without curling.

---

## 8. Frontend notes

- **300ms debounce** on the search input — industry standard; fast enough to feel
  instant, slow enough to cut backend calls meaningfully (visible as fewer
  requests in the metrics).
- Live dropdown with **keyboard navigation** (arrows + Enter), compact count
  labels ("88k"), and loading/error/empty states.
- Trending panel with a **basic↔enhanced** toggle for the side-by-side demo.

---

## 9. Decision cheat-sheet (viva one-liners)

- **Node/Express:** I/O-bound; event loop fits concurrent reads.
- **Trie:** O(L) lookup, dataset-size-independent; beats O(N) scan and precomputed map.
- **Postgres = truth, Redis = cache, trie = index from Postgres.**
- **Cache-aside:** miss falls back to trie + back-fills; user always answered.
- **Cache ranked strings + rounded snapshot:** small count changes don't churn it.
- **TTL-only, long TTL:** orderings stable; favor hit rate; staleness ≤ TTL; clocks decoupled.
- **Consistent hashing + virtual nodes:** spread keys, avoid hot-spotting; remove a node → only ~1/N keys remap (vs `hash % N` remapping all). Routing/partitioning, not throughput.
- **Trending ZSET + exponential decay:** live ranking, nothing to invalidate; decay kills stale spikes; τ by half-life; seeds normalized to live scale; cost is a tunable constant + eventually-large scores.
- **Batch writes (Map, aggregate, dual triggers, upsert):** reduces write pressure; crash loses unflushed window — acceptable for analytics counts.
- **300ms debounce:** cuts backend calls without feeling laggy.

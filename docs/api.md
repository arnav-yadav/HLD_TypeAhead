# API Documentation

Base URL (dev): `http://localhost:4000`. The React client reaches these via the
Vite `/api` proxy.

---

## `GET /suggest?q=<prefix>`

Prefix suggestions, up to 10, sorted by **count descending, then alphabetical**.
No recency here (recency lives in `/trending`). Empty prefix or no match → `200`
with an empty list (never a 404).

**Query params**
- `q` *(string)* — the typed prefix. Normalized `toLowerCase().trim()` server-side.

**Response `200`**
```json
{
  "prefix": "iph",
  "suggestions": [
    { "query": "iphone", "count": 100000 },
    { "query": "iphone 15", "count": 88000 }
  ]
}
```
`count` is a **rounded snapshot** taken at cache-write time, not a guaranteed live
value (small count changes don't churn the cache). The UI renders it compact ("88k").

---

## `POST /search`

Submit a search. Buffers a count increment (not a synchronous DB write) and bumps
the decayed trending ZSET. New queries become suggestible immediately.

**Body**
```json
{ "query": "iphone" }
```
Normalized `trim().toLowerCase()`. Empty after trimming → ignored (no blank entry),
but still returns the standard body.

**Response `200`**
```json
{ "message": "Searched" }
```
> Exactly this shape — no extra fields (per spec).

---

## `GET /cache/debug?prefix=<prefix>`

Shows how the consistent-hash ring routes a prefix and whether it's cached now.

**Response `200`**
```json
{
  "prefix": "iph",
  "node": { "id": "node1", "host": "localhost", "port": 6380 },
  "hit": true,
  "ringDistribution": { "node0": 0.34, "node1": 0.33, "node2": 0.33 },
  "virtualNodesPerNode": 150
}
```
`ringDistribution` is the fraction of the 2³² keyspace each physical node owns —
proof that virtual nodes balance the ring.

---

## `GET /trending?mode=enhanced|basic`

Trending list. Default `enhanced`.

- **enhanced** — recency-aware, from the decayed ZSET. Items have a `score`.
- **basic** — raw all-time counts from the in-process map. Items have a `count`.

**Response `200` (enhanced)**
```json
{ "mode": "enhanced", "items": [ { "query": "iphone", "score": 412.7 } ] }
```
**Response `200` (basic)**
```json
{ "mode": "basic", "items": [ { "query": "iphone", "count": 100000 } ] }
```

---

## `GET /health`

Liveness for Redis nodes + Postgres. Returns `200` when Postgres is up and at
least one Redis node responds, else `503`.

```json
{
  "status": "ok",
  "redis": [ { "id": "node0", "host": "localhost", "port": 6379, "ok": true } ],
  "postgres": true
}
```

---

## `GET /stats`

All instrumentation in one payload (drives the live metrics panel).

```json
{
  "latencyMs": { "p50": 0.4, "p95": 1.2, "p99": 3.1, "samples": 1000 },
  "cache": { "hits": 870, "misses": 130, "hitRate": 0.87 },
  "db": { "reads": 1, "writes": 14 },
  "searchCount": 2000,
  "buffer": { "pendingIncrements": 37, "pendingEntries": 6, "totalFlushes": 14 },
  "trieSize": 102682
}
```
The headline: `db.writes` ≪ `searchCount` — batching reduces write pressure.

---

## Not implemented (by design)

- **`/admin/flush`** — intentionally omitted. Buffer state is observable via
  `/stats` instead, so batching is demonstrable without a manual trigger.
- **No extra fields on `/search`** — the response is strictly `{ "message": "Searched" }`.

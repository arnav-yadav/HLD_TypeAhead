"""
test_typeahead.py — API + behavioral test suite for the Search Typeahead system.

Covers (layers 1 & 2 of the test plan):
  • Functional / black-box API tests  — deterministic asserts on responses
  • Behavioral / timing-aware tests    — assert PROPERTIES (ratios, ordering,
                                         "rank improved"), never exact values on
                                         the timing/probabilistic parts.

These tests run against the RUNNING server over HTTP, so they need no source code.
They assert the contract from CLAUDE.md. If the build deviated from that contract,
the failure tells you exactly where — fix the code or consciously update the spec.

USAGE
  pip install pytest requests
  # start the stack first: docker compose up -d  &&  npm start (server)
  BASE_URL=http://localhost:4000 pytest test_typeahead.py -v

  # skip the slow timing tests during quick runs:
  pytest test_typeahead.py -v -m "not slow"

NOTE on timing tests: thresholds are deliberately lenient to avoid flaky
false-failures. They prove direction/ratio, not precise numbers.
"""

import os
import time
import string
import random
# pyrefly: ignore [missing-import]
import pytest
import requests

BASE_URL = os.environ.get("BASE_URL", "http://localhost:4000").rstrip("/")
# Must be >= the server's FLUSH_INTERVAL_MS; bump if you raised that in .env.
FLUSH_WAIT_S = float(os.environ.get("FLUSH_WAIT_S", "7"))

# ----------------------------------------------------------------------------- helpers
def get(path, **params):
    return requests.get(f"{BASE_URL}{path}", params=params, timeout=10)

def post(path, json=None):
    return requests.post(f"{BASE_URL}{path}", json=json, timeout=10)

def suggest(prefix):
    r = get("/suggest", q=prefix)
    assert r.status_code == 200, f"/suggest?q={prefix!r} -> {r.status_code}: {r.text[:200]}"
    return r.json()

def suggestion_queries(body):
    """Extract the list of query strings from a /suggest body, tolerant of the
    documented shape {prefix, suggestions:[{query,count}]}."""
    items = body.get("suggestions", body if isinstance(body, list) else [])
    out = []
    for it in items:
        if isinstance(it, dict):
            out.append(it.get("query"))
        else:
            out.append(it)
    return out

def suggestion_counts(body):
    items = body.get("suggestions", [])
    return [it.get("count") for it in items if isinstance(it, dict) and "count" in it]

def rand_token(n=12):
    return "zzq" + "".join(random.choices(string.ascii_lowercase, k=n))


# ----------------------------------------------------------------------------- fixtures
@pytest.fixture(scope="session", autouse=True)
def server_up():
    """Skip the whole suite cleanly if the server isn't reachable."""
    try:
        r = get("/health")
    except Exception as e:
        pytest.skip(f"Server not reachable at {BASE_URL} ({e}). Start the stack first.")
    if r.status_code != 200:
        pytest.skip(f"/health returned {r.status_code}; server not ready.")


# =============================================================================
# 1. /suggest — functional
# =============================================================================
class TestSuggest:
    def test_returns_at_most_10(self):
        body = suggest("i")
        assert len(suggestion_queries(body)) <= 10

    def test_known_prefix_has_results(self):
        qs = suggestion_queries(suggest("iph"))
        assert any(q and q.startswith("iph") for q in qs), f"got {qs}"

    def test_all_results_match_prefix(self):
        prefix = "iph"
        for q in suggestion_queries(suggest(prefix)):
            assert q.startswith(prefix), f"{q!r} does not start with {prefix!r}"

    def test_sorted_count_desc_then_alpha(self):
        body = suggest("i")
        items = body.get("suggestions", [])
        # counts non-increasing
        counts = [it["count"] for it in items]
        assert counts == sorted(counts, reverse=True), f"counts not desc: {counts}"
        # within equal-count runs, queries alphabetical
        i = 0
        while i < len(items):
            j = i
            while j < len(items) and items[j]["count"] == items[i]["count"]:
                j += 1
            group = [items[k]["query"] for k in range(i, j)]
            assert group == sorted(group), f"tie group not alphabetical: {group}"
            i = j

    def test_case_insensitive(self):
        assert suggestion_queries(suggest("IPH")) == suggestion_queries(suggest("iph"))

    def test_whitespace_trimmed(self):
        assert suggestion_queries(suggest("  iph  ")) == suggestion_queries(suggest("iph"))

    def test_no_match_returns_empty_200(self):
        body = suggest(rand_token())          # vanishingly unlikely to exist
        assert suggestion_queries(body) == []

    def test_single_char(self):
        body = suggest("a")
        assert isinstance(suggestion_queries(body), list)

    def test_very_long_prefix_no_crash(self):
        body = suggest("iphone " * 20)
        assert suggestion_queries(body) == []

    @pytest.mark.parametrize("weird", ["iph%", "ip he", "i'ph", "ip\"h", "++", "你好", "  "])
    def test_special_chars_dont_crash(self, weird):
        r = get("/suggest", q=weird)
        assert r.status_code == 200, f"{weird!r} -> {r.status_code}"
        assert isinstance(suggestion_queries(r.json()), list)

    def test_empty_q_no_crash(self):
        r = get("/suggest", q="")
        assert r.status_code == 200
        assert isinstance(suggestion_queries(r.json()), list)

    def test_response_shape(self):
        body = suggest("iph")
        assert "suggestions" in body, f"missing 'suggestions': {body.keys()}"
        if body["suggestions"]:
            it = body["suggestions"][0]
            assert "query" in it and "count" in it, f"item shape: {it}"


# =============================================================================
# 2. /search — functional
# =============================================================================
class TestSearch:
    def test_exact_response_body(self):
        r = post("/search", json={"query": "iphone"})
        assert r.status_code == 200
        assert r.json() == {"message": "Searched"}, f"got {r.json()}"

    def test_empty_query_ignored_no_crash(self):
        r = post("/search", json={"query": ""})
        assert r.status_code == 200
        # empty must never become a suggestion
        assert "" not in suggestion_queries(suggest(""))

    def test_whitespace_query_ignored(self):
        r = post("/search", json={"query": "    "})
        assert r.status_code == 200

    def test_new_query_becomes_suggestible(self):
        novel = rand_token()              # fresh, never-seen query
        # search BEFORE first suggesting its prefix, so we don't cache an empty
        # result that TTL would then keep serving.
        post("/search", json={"query": novel})
        time.sleep(0.5)                   # allow synchronous trie insert
        prefix = novel[:5]
        qs = suggestion_queries(suggest(prefix))
        assert novel in qs, f"{novel!r} not suggestible under {prefix!r}: {qs}"


# =============================================================================
# 3. /cache/debug — routing + distribution
# =============================================================================
class TestCacheDebug:
    def _node_id(self, body):
        node = body.get("node", body)
        if isinstance(node, dict):
            return node.get("id", node.get("port", str(node)))
        return str(node)

    def test_returns_node_assignment(self):
        r = get("/cache/debug", prefix="iph")
        assert r.status_code == 200
        assert "node" in r.json(), f"missing 'node': {r.json()}"

    def test_routing_is_deterministic(self):
        a = get("/cache/debug", prefix="samsung").json()
        b = get("/cache/debug", prefix="samsung").json()
        assert self._node_id(a) == self._node_id(b), "same prefix routed to different nodes"

    @pytest.mark.slow
    def test_distribution_roughly_fair(self):
        """Virtual-nodes proof: hash many prefixes, expect all 3 nodes used and
        none starved. Lenient: each node >= 10% of keys."""
        counts = {}
        for _ in range(600):
            p = rand_token(6)
            nid = self._node_id(get("/cache/debug", prefix=p).json())
            counts[nid] = counts.get(nid, 0) + 1
        assert len(counts) >= 3, f"expected ~3 nodes, saw {counts}"
        total = sum(counts.values())
        for nid, c in counts.items():
            assert c / total >= 0.10, f"node {nid} starved: {counts}"


# =============================================================================
# 4. /trending, /health, /stats — shape
# =============================================================================
class TestTrendingHealthStats:
    def _items(self, body):
        return body.get("items", body if isinstance(body, list) else [])

    def test_trending_enhanced(self):
        r = get("/trending")
        assert r.status_code == 200
        assert isinstance(self._items(r.json()), list)

    def test_trending_basic_mode(self):
        r = get("/trending", mode="basic")
        assert r.status_code == 200
        assert isinstance(self._items(r.json()), list)

    def test_health_ok(self):
        assert get("/health").json().get("status") == "ok"

    def test_stats_has_expected_fields(self):
        s = get("/stats").json()
        blob = str(s).lower()
        # tolerant: look for the concepts, not exact key names
        assert "p95" in blob or "latency" in blob, f"no latency stat: {s}"
        assert "hit" in blob, f"no hit-rate stat: {s}"
        assert "write" in blob, f"no db-write stat: {s}"


# =============================================================================
# 5. Behavioral — timing-aware (PROPERTIES, not exact values)
# =============================================================================
@pytest.mark.slow
class TestBehavioral:
    def _stat(self, *names):
        """Pull a numeric stat by trying several likely key names (flat or nested)."""
        s = get("/stats").json()
        def walk(d):
            for k, v in (d.items() if isinstance(d, dict) else []):
                if isinstance(v, dict):
                    yield from walk(v)
                else:
                    yield k.lower(), v
        flat = dict(walk(s))
        for n in names:
            for k, v in flat.items():
                if n in k and isinstance(v, (int, float)):
                    return v
        return None

    def test_batch_write_reduction(self):
        """Fire many searches of a few repeated terms; DB writes should be far
        fewer than searches (aggregation + batching)."""
        writes_before = self._stat("write") or 0
        terms = ["iphone", "samsung galaxy", "python"]
        N = 150
        for i in range(N):
            post("/search", json={"query": terms[i % len(terms)]})
        time.sleep(FLUSH_WAIT_S)          # let the buffer flush
        writes_after = self._stat("write")
        if writes_after is None:
            pytest.skip("no DB-write counter exposed in /stats")
        delta = writes_after - writes_before
        # 150 searches of 3 terms should cost only a handful of write ops.
        assert delta < N / 3, f"writes={delta} not << searches={N} (batching weak?)"

    def test_cache_miss_then_hit(self):
        """A fresh prefix: first /suggest is a miss, immediate second is a hit."""
        hits_before = self._stat("hit")
        if hits_before is None:
            pytest.skip("no hit counter exposed in /stats")
        p = rand_token(6)
        suggest(p)                        # miss -> back-fills cache
        suggest(p)                        # should be a hit now
        hits_after = self._stat("hit")
        assert hits_after > hits_before, "second identical /suggest did not register a hit"

    def test_trending_recency_lifts_rank(self):
        """Hammer one term; its trending rank should improve (or it should
        appear). Asserts direction, not absolute score."""
        def rank_of(term):
            items = get("/trending").json().get("items", [])
            qs = [it.get("query") if isinstance(it, dict) else it for it in items]
            return qs.index(term) if term in qs else None

        # pick a term unlikely to already be #1 so there's room to climb
        term = "python tutorial"
        before = rank_of(term)
        for _ in range(120):
            post("/search", json={"query": term})
        time.sleep(1.0)
        after = rank_of(term)
        assert after is not None, f"{term!r} absent from trending after hammering"
        if before is not None:
            assert after <= before, f"rank worsened: before={before} after={after}"

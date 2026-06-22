-- Source of truth for query -> count. PK on `query` gives fast upsert lookups
-- (the ON CONFLICT batch upsert in batch/buffer.js depends on it).
--
-- No prefix index here on purpose: prefix matching is the Trie's job, not the
-- DB's. The startup load reads every row ONCE to build the in-memory trie, so
-- the DB never serves a prefix query.
CREATE TABLE IF NOT EXISTS queries (
  query TEXT PRIMARY KEY,
  count BIGINT NOT NULL DEFAULT 0
);

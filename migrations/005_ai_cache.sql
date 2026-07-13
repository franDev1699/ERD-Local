-- migrations/005_ai_cache.sql
CREATE TABLE IF NOT EXISTS ai_cache (
  hash TEXT PRIMARY KEY,
  response TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

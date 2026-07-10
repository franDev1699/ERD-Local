-- migrations/003_ai_config.sql

CREATE TABLE IF NOT EXISTS user_ai_configs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  model TEXT,
  api_key TEXT,
  api_url TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

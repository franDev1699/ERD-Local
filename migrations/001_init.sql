-- migrations/001_init.sql

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  display_name TEXT NOT NULL,
  color TEXT,
  is_admin INTEGER NOT NULL DEFAULT 0 CHECK (is_admin IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
) STRICT;

CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
) STRICT;

CREATE TABLE project_members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner','editor','viewer')),
  PRIMARY KEY (project_id, user_id)
) STRICT;

CREATE TABLE ai_prompt_configs (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('global','user')),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE, -- NULL si scope = 'global'
  prompt_key TEXT NOT NULL,
  prompt_template TEXT NOT NULL,
  model TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (scope, user_id, prompt_key)
) STRICT;

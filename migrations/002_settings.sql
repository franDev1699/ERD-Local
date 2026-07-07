-- migrations/002_settings.sql

CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

INSERT OR IGNORE INTO system_settings (key, value) VALUES ('allow_public_registration', 'true');

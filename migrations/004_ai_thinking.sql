-- migrations/004_ai_thinking.sql

ALTER TABLE user_ai_configs ADD COLUMN enable_thinking INTEGER DEFAULT 0;

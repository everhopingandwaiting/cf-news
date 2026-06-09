-- Migration 005: Add detailed AI call logging columns
-- Applied: 2026-06-09
--
-- Keeps D1 schema in sync with src/db/schema.ts and aiProvider.logAICall().

ALTER TABLE ai_call_log ADD COLUMN model TEXT;
ALTER TABLE ai_call_log ADD COLUMN news_title TEXT;
ALTER TABLE ai_call_log ADD COLUMN response_preview TEXT;
ALTER TABLE ai_call_log ADD COLUMN duration_ms INTEGER;
ALTER TABLE ai_call_log ADD COLUMN error TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_call_news ON ai_call_log(news_id);

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '5');

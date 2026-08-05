-- Fix created_at columns that stored the literal string 'CURRENT_TIMESTAMP'
-- (drizzle `.default('CURRENT_TIMESTAMP')` writes the string instead of letting
-- SQLite's DEFAULT CURRENT_TIMESTAMP apply). Rewrite to the real insert time.
UPDATE ai_call_log SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE created_at = 'CURRENT_TIMESTAMP';
UPDATE news_summaries SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE created_at = 'CURRENT_TIMESTAMP';
UPDATE users SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE created_at = 'CURRENT_TIMESTAMP';
UPDATE users SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE updated_at = 'CURRENT_TIMESTAMP';

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '11');

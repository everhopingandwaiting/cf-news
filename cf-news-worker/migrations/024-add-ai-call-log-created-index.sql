-- Add created_at index to ai_call_log.
-- modelRefresher evidence pruning runs `SELECT ... FROM ai_call_log WHERE created_at >= ?
-- GROUP BY provider, model` every 6h; without this index it's a full table scan
-- (59k+ rows). Combined with the 5-min shortItems scan it helped blow D1's
-- free-tier daily read quota (5M rows/day), causing the 09-01 production 500s.
CREATE INDEX IF NOT EXISTS idx_ai_call_log_created ON ai_call_log(created_at);

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '24');
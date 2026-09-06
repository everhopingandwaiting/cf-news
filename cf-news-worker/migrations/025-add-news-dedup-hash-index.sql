-- Add index on news_items.dedup_hash.
-- checkDuplicate/checkByHash runs `SELECT id FROM news_items WHERE dedup_hash = ?
-- AND is_deleted = 0` for EVERY item during fetch. dedup_hash was added via
-- ALTER TABLE and never indexed, so every dedup check is a full table scan of
-- news_items (122k+ rows). The fetch pipeline runs through the always-draining
-- Queues consumer, producing a continuous multi-hundred-million-row/day read
-- load — the root cause of the D1 free-tier daily read quota (5M rows/day)
-- blowouts behind the 09-01+ production 7500 outages.
CREATE INDEX IF NOT EXISTS idx_news_dedup_hash ON news_items(dedup_hash);

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '25');

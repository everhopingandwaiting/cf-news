-- Add summary_pending flag + pending queue index on news_items.
-- The summarizer's pending query was a `LEFT JOIN news_summaries ns ON
-- ns.news_id = n.id WHERE ns.id IS NULL` anti-join, which scans the whole
-- 7-day window (120k+ rows) on every cron run to find rows without a summary.
-- With a summary_pending flag + composite index, the query only reads the
-- small pending subset, cutting one of the heaviest D1 read loads.
ALTER TABLE news_items ADD COLUMN summary_pending INTEGER NOT NULL DEFAULT 1;

CREATE INDEX IF NOT EXISTS idx_news_items_pending ON news_items(summary_pending, created_at DESC);

-- Backfill: rows that already carry a summarised entry are marked done so the
-- next cron only picks up the genuinely pending rows; existing unsent rows
-- stay pending=1 and will be drained by the summarizer queue as before.
UPDATE news_items SET summary_pending = 0
WHERE EXISTS (SELECT 1 FROM news_summaries ns WHERE ns.news_id = news_items.id);

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '26');
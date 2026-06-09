-- Migration 004: Track per-source fetch errors
-- Applied: 2026-06-09
--
-- Keeps existing D1 databases in sync with src/db/schema.sql.

ALTER TABLE news_sources ADD COLUMN error_count INTEGER DEFAULT 0;

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '4');

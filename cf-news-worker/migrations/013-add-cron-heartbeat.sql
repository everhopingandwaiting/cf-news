-- Cron heartbeat tracking for feed freshness monitoring.
-- Every scheduled handler writes its last-fire time here; the /api/health/feed
-- endpoint and external uptime monitors read it to detect cron scheduler
-- outages (observed 2026-08-07/08: all crons silently stopped for ~10h while
-- HTTP requests stayed healthy).
CREATE TABLE IF NOT EXISTS cron_heartbeat (
    cron_name TEXT PRIMARY KEY,
    last_fired_at DATETIME NOT NULL
);

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '13');

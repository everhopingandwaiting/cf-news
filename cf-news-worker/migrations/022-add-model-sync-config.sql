-- Seed config keys for the auto model-sync service (modelRefresher.ts).
-- The service periodically reconciles provider_models against live /models
-- endpoints, quality-probes candidates, and prunes dead models. All knobs
-- are tunable via app_config; defaults here match the service constants so
-- the cron works out of the box.

INSERT OR REPLACE INTO app_config (key, value) VALUES
  ('model_sync_enabled', '1'),
  ('model_sync_max_probes', '3'),
  ('model_sync_probe_cooldown', '86400'),
  ('model_sync_baseline_score', '60'),
  ('model_sync_summary_window_days', '2'),
  ('model_sync_evidence_min_attempts', '20');

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '22');

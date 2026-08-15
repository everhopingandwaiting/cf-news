-- Refresh zen (opencode.ai/zen) free model catalog against the live API
-- (verified 2026-08-15). /v1/models returns 62 models; only the 6 FREE
-- models are usable without billing. longcat-2.0-free is no longer served.

-- New free models from the live catalog:
--   hy3-free                   (unknown specs -> conservative defaults)
--   mimo-v2.5-free             (200K ctx / 32K out per opencode config)
--   nemotron-3.5-lightning-free (fast variant of nemotron-3 series)
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type, context_size, max_output) VALUES
  ('zen', 'hy3-free', 80, 1, 'text', 131072, 4096),
  ('zen', 'mimo-v2.5-free', 75, 1, 'text', 200000, 32000),
  ('zen', 'nemotron-3.5-lightning-free', 85, 1, 'text', 131072, 4096);

-- Temporarily disable deepseek-v4-flash-free (user request 2026-08-15).
-- Keep the row so it can be re-enabled with a one-line UPDATE.
UPDATE provider_models SET enabled = 0 WHERE provider = 'zen' AND model_id = 'deepseek-v4-flash-free';

-- longcat-2.0-free no longer exists in the live zen catalog -> disable.
UPDATE provider_models SET enabled = 0 WHERE provider = 'zen' AND model_id = 'longcat-2.0-free';

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '16');

-- Disable dead models (0% recent success + historically <30% success).
-- Analysis from ai_call_log (2026-05-28 ~ 2026-08-18):
--   freemodel  gpt-5.4 / gpt-5.4-mini / gpt-5.3-codex  — 2~8% historical, 0% since 08-15 (HTTP 401 Insufficient balance)
--   freemodel  gpt-5.5                                — 39% historical but 0% since 08-15 (same account balance issue)
--   openrouter nvidia/nemotron-3-ultra-550b-a55b:free — 11.3% (mostly 429 rate limit)
--   openrouter nvidia/nemotron-3-nano-30b-a3b:free    — 15.4%
--   zen        nemotron-3-ultra-free                  — 6.8% (FreeUsageLimitError)
-- Keep the rows so providers can be re-enabled with a one-line UPDATE after
-- top-up (freemodel) or upstream rate-limit changes (openrouter/zen).

UPDATE provider_models SET enabled = 0 WHERE provider = 'freemodel' AND model_id IN ('gpt-5.5','gpt-5.4','gpt-5.4-mini','gpt-5.3-codex');
UPDATE provider_models SET enabled = 0 WHERE provider = 'openrouter' AND model_id IN ('nvidia/nemotron-3-ultra-550b-a55b:free','nvidia/nemotron-3-nano-30b-a3b:free');
UPDATE provider_models SET enabled = 0 WHERE provider = 'zen' AND model_id = 'nemotron-3-ultra-free';

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '18');
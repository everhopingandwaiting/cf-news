-- Per-model context window & max output configuration.
-- Defaults keep existing behavior safe (128K ctx / 4K out), zen models set to
-- their official documented limits (verified 2026-08-09).
ALTER TABLE provider_models ADD COLUMN context_size INTEGER NOT NULL DEFAULT 131072;
ALTER TABLE provider_models ADD COLUMN max_output INTEGER NOT NULL DEFAULT 4096;

-- zen free models (official docs):
--   deepseek-v4-flash-free: 1M ctx / 384K out (DeepSeek docs)
--   nemotron-3-ultra-free: 1M ctx / 256K out (NVIDIA NIM docs, native 256K)
--   longcat-2.0-free: 1M ctx / 128K out (Meituan LongCat API docs)
--   laguna-s-2.1-free: 256K ctx / 64K out (poolside free endpoint, paid is 1M)
UPDATE provider_models SET context_size = 1000000, max_output = 384000 WHERE provider = 'zen' AND model_id = 'deepseek-v4-flash-free';
UPDATE provider_models SET context_size = 1000000, max_output = 262144 WHERE provider = 'zen' AND model_id = 'nemotron-3-ultra-free';
UPDATE provider_models SET context_size = 1000000, max_output = 128000 WHERE provider = 'zen' AND model_id = 'longcat-2.0-free';
UPDATE provider_models SET context_size = 262144, max_output = 65536 WHERE provider = 'zen' AND model_id = 'laguna-s-2.1-free';

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '15');

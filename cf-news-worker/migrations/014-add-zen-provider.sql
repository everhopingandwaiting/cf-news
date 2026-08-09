-- Add zen provider (OpenAI-compatible aggregation API at https://opencode.ai/zen/v1)
-- Aggregates Claude/GPT/Gemini/DeepSeek/Kimi/GLM/Qwen. Only FREE models are enabled
-- (verified working 2026-08-09; paid models require billing → 401 CreditsError,
--  ling/mimo return empty content, north-mini-code returns 401).
INSERT OR IGNORE INTO providers (name, base_url, api_key_env, priority, enabled)
VALUES ('zen', 'https://opencode.ai/zen/v1', 'ZEN_API_KEY', 60, 1);

-- DeepSeek first (priority), then other verified free models
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type) VALUES ('zen', 'deepseek-v4-flash-free', 95, 1, 'text');
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type) VALUES ('zen', 'nemotron-3-ultra-free', 85, 1, 'text');
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type) VALUES ('zen', 'longcat-2.0-free', 80, 1, 'text');
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type) VALUES ('zen', 'laguna-s-2.1-free', 75, 1, 'text');

-- Append zen at the end of the provider chain (backup provider, don't displace
-- the current stable providers nvidia/openrouter/cloudflare)
INSERT OR REPLACE INTO app_config (key, value) VALUES
  ('provider_order', 'nvidia,openrouter,cloudflare,freemodel,agnes,mango,groq,zen');

-- 失败模型拉黑 5 分钟（默认 15 分钟对 zen 这类免费限流型 provider 偏长）
INSERT OR IGNORE INTO app_config (key, value) VALUES ('ai_failed_model_ttl_seconds', '300');

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '14');

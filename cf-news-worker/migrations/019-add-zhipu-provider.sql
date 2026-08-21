-- Add zhipu provider (Zhipu AI / BigModel OpenAI-compatible API at https://open.bigmodel.cn/api/paas/v4)
-- Free models verified working 2026-08-20:
--   glm-4.7-flash       — official current free flagship (200K ctx / 128K out, Agentic Coding)
--   glm-4-flash-250414  — first free GLM API (128K ctx)
--   glm-4.5-flash is EOL (2026-01-30) and auto-routes to glm-4.7-flash, so use the new id.
-- Rate limits: strict per-account concurrency caps (1302) + platform overload protection (1305,
--   "该模型当前访问量过大") on free models — burst calls get 429, recover after a few seconds.
-- Our provider-block mechanism (isRateLimitError → markProviderFailed) handles this: the chain
-- cools the provider on 429 and moves on, so zhipu is safe as a chain-tail backup provider.
INSERT OR IGNORE INTO providers (name, base_url, api_key_env, priority, enabled)
VALUES ('zhipu', 'https://open.bigmodel.cn/api/paas/v4', 'ZHIPU_API_KEY', 60, 1);

INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type, context_size, max_output) VALUES
  ('zhipu', 'glm-4.7-flash', 80, 1, 'text', 200000, 128000),
  ('zhipu', 'glm-4-flash-250414', 70, 1, 'text', 128000, 4096);

-- Append zhipu at the end of the provider chain (backup provider, don't displace
-- the current stable providers nvidia/openrouter/cloudflare)
INSERT OR REPLACE INTO app_config (key, value) VALUES
  ('provider_order', 'nvidia,openrouter,cloudflare,freemodel,agnes,mango,groq,zen,orcarouter,zhipu');

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '19');
-- Add orcarouter provider (OpenAI-compatible aggregation API at https://api.orcarouter.ai/v1)
-- Aggregates Claude/GPT/Gemini/DeepSeek/Kimi/GLM/Qwen. Only FREE models are enabled
-- (verified working 2026-08-16; paid models require billing → "insufficient credits").
INSERT OR IGNORE INTO providers (name, base_url, api_key_env, priority, enabled)
VALUES ('orcarouter', 'https://api.orcarouter.ai/v1', 'ORCAROUTER_API_KEY', 60, 1);

-- Verified free models (all accept max_tokens=10000):
--   orcarouter/free                    — 官方免费聚合入口（自动路由）
--   deepseek/deepseek-v4-flash-free    — DeepSeek V4 Flash 免费版
--   deepseek/deepseek-v4-pro-free      — DeepSeek V4 Pro 免费版
--   qwen/qwen3.8-27b-free              — Qwen 3.8 27B 免费版
--   tencent/hy3-free                   — 腾讯混元 hy3 免费版
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type, context_size, max_output) VALUES
  ('orcarouter', 'orcarouter/free', 90, 1, 'text', 131072, 4096),
  ('orcarouter', 'deepseek/deepseek-v4-flash-free', 85, 1, 'text', 1000000, 384000),
  ('orcarouter', 'deepseek/deepseek-v4-pro-free', 80, 1, 'text', 1000000, 384000),
  ('orcarouter', 'qwen/qwen3.8-27b-free', 75, 1, 'text', 262144, 65536),
  ('orcarouter', 'tencent/hy3-free', 70, 1, 'text', 262144, 8192);

-- Append orcarouter at the end of the provider chain (backup provider, don't displace
-- the current stable providers nvidia/openrouter/cloudflare)
INSERT OR REPLACE INTO app_config (key, value) VALUES
  ('provider_order', 'nvidia,openrouter,cloudflare,freemodel,agnes,mango,groq,zen,orcarouter');

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '17');
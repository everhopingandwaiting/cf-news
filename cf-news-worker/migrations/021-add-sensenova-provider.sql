-- Add sensenova provider (SenseNova token API at https://token.sensenova.cn/v1)
-- OpenAI-compatible API from SenseTime. Registered 2026-08-27 with a live
-- chat-completion probe (deepseek-v4-flash returned content successfully).
--   deepseek-v4-flash       — DeepSeek V4 Flash on SenseNova (131K ctx / 8K out)
--   sensenova-6.7-flash-lite — SenseNova 6.7 Flash Lite (131K ctx / 4K out)
-- priority 65: chain-tail backup provider (below zhipu 60? no — 65 > 60 means
-- it slots after zhipu in the chain; new provider kept low until proven reliable).
INSERT OR IGNORE INTO providers (name, base_url, api_key_env, priority, enabled)
VALUES ('sensenova', 'https://token.sensenova.cn/v1', 'SENSENOVA_API_KEY', 65, 1);

INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type, context_size, max_output) VALUES
  ('sensenova', 'deepseek-v4-flash', 88, 1, 'text', 131072, 8192),
  ('sensenova', 'sensenova-6.7-flash-lite', 82, 1, 'text', 131072, 4096);

-- Append sensenova at the end of the provider chain (backup provider, don't displace
-- the current stable providers nvidia/openrouter/cloudflare)
INSERT OR REPLACE INTO app_config (key, value) VALUES
  ('provider_order', 'nvidia,openrouter,cloudflare,freemodel,agnes,mango,groq,zen,orcarouter,zhipu,sensenova');

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '21');
-- Add agnes provider (OpenAI-compatible API at https://apihub.agnes-ai.com)
INSERT OR IGNORE INTO providers (name, base_url, api_key_env, priority, enabled)
VALUES ('agnes', 'https://apihub.agnes-ai.com/v1', 'AGNES_API_KEY', 55, 1);

INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('agnes', 'agnes-2.0-flash', 90, 1);
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('agnes', 'agnes-1.5-flash', 80, 1);

-- Set provider order: agnes after freemodel, before groq
INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'freemodel,agnes,groq,cloudflare,openrouter,nvidia,mango');

INSERT OR IGNORE INTO app_config (key, value) VALUES ('schema_version', '4');

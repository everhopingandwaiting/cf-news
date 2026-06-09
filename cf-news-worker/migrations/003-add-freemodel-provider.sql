-- Add freemodel provider (OpenAI-compatible API at https://api.freemodel.dev)
INSERT OR IGNORE INTO providers (name, base_url, api_key_env, priority, enabled)
VALUES ('freemodel', 'https://api.freemodel.dev/v1', 'FREEMODEL_API_KEY', 50, 1);

INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('freemodel', 'gpt-5.5', 90, 1);
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('freemodel', 'gpt-5.4', 85, 1);
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('freemodel', 'gpt-5.4-mini', 80, 1);
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('freemodel', 'gpt-5.3-codex', 70, 1);

-- Set provider order: freemodel first, then existing providers
INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'freemodel,groq,cloudflare,openrouter,nvidia,mango');

INSERT OR IGNORE INTO app_config (key, value) VALUES ('schema_version', '3');

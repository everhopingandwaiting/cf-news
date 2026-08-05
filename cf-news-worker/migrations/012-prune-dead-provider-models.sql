-- Disable provider models that are decommissioned / returning 404/410/403/503
-- or consistently timing out in production (audited via ai_call_log 2026-08-05).
-- Providers re-verified against their current model catalogs.

-- nvidia: keep only models with recent production success
-- (llama-4-maverick, deepseek-v4-flash, llama-3.1-8b)
UPDATE provider_models SET enabled = 0 WHERE provider = 'nvidia' AND model_id IN (
  'meta/llama-3.3-70b-instruct',            -- consistent 30s timeout
  'google/gemma-4-31b-it',                  -- consistent 30s timeout
  'minimaxai/minimax-m2.7',                 -- HTTP 410 Gone (deprecated)
  'qwen/qwen3-next-80b-a3b-instruct',       -- HTTP 410 Gone (deprecated)
  'microsoft/phi-4-mini-instruct',          -- HTTP 410 Gone (deprecated)
  'deepseek-ai/deepseek-coder-6.7b-instruct',-- HTTP 404 (removed)
  'moonshotai/kimi-k2.6',                   -- HTTP 410 Gone (deprecated)
  '01-ai/yi-large',                         -- HTTP 404 (removed)
  'mistralai/mistral-large',                -- HTTP 404 (removed)
  'mistralai/mistral-7b-instruct-v0.3',     -- HTTP 404 (removed)
  'google/gemma-3-12b-it'                   -- HTTP 404 (removed)
);

-- groq: gemma2-9b-it decommissioned
UPDATE provider_models SET enabled = 0 WHERE provider = 'groq' AND model_id = 'gemma2-9b-it';

-- cloudflare: llama-3/3.1 deprecated by Workers AI (error 5028); mistral-7b free
-- allocation exhausted. Only llama-3.3-70b-instruct-fp8-fast confirmed healthy.
UPDATE provider_models SET enabled = 0 WHERE provider = 'cloudflare' AND model_id IN (
  '@cf/meta/llama-3-8b-instruct',
  '@cf/meta/llama-3.1-8b-instruct',
  '@cf/mistral/mistral-7b-instruct-v0.1'
);

-- agnes: only agnes-2.0-flash returns success; images/video are separate
-- (not text) and blocked/503; 1.5-flash model_not_found
UPDATE provider_models SET enabled = 0 WHERE provider = 'agnes' AND model_id IN (
  'agnes-1.5-flash',
  'agnes-image-2.0-flash',
  'agnes-image-2.1-flash',
  'agnes-video-v2.0'
);

-- openrouter: previous free models no longer exist (404 No endpoints / 400
-- invalid). Replace with current catalog verified via API.
UPDATE provider_models SET enabled = 0 WHERE provider = 'openrouter' AND model_id IN (
  'microsoft/phi-4-mini-instruct:free',
  'google/gemma-2-9b-it:free',
  'qwen/qwen2.5-7b-instruct:free',
  'deepseek/deepseek-v4-flash:free',
  'mistralai/mistral-7b-instruct:free'
);
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type) VALUES
  ('openrouter', 'nvidia/nemotron-3-super-120b-a12b:free', 85, 1, 'text'),
  ('openrouter', 'nvidia/nemotron-3-ultra-550b-a55b:free', 80, 1, 'text'),
  ('openrouter', 'nvidia/nemotron-3-nano-30b-a3b:free', 75, 1, 'text');

-- Reorder provider chain: healthy providers first. freemodel (insufficient
-- balance) and agnes (model blocked) moved to the end so their 4xx/403 retries
-- don't burn subrequests before the working providers get a chance.
INSERT OR REPLACE INTO app_config (key, value) VALUES
  ('provider_order', 'groq,nvidia,openrouter,cloudflare,freemodel,agnes,mango');

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '12');

-- Refresh provider model catalogs against live /models endpoints + real
-- chat-completion probes (2026-08-21). Evidence per block below.
--
-- 1) ADD verified-working models (real chat completion returned content):
--    nvidia    nemotron-3-super-120b-a12b / gpt-oss-120b / kimi-k3 /
--              minimax-m3 / nemotron-3.5-lightning-30b-a3b / gpt-oss-20b /
--              inkling
--
-- 1b) DISABLE nvidia reasoning models that break structured JSON tasks
--     (verified live 2026-08-21):
--    nemotron-3-super-120b-a12b — chain-of-thought is emitted INSIDE
--      message.content ("We need to produce a Chinese sentence..."), polluting
--      downstream JSON extraction; live take generation returned empty.
--      Other NVIDIA reasoning models (gpt-oss-20b, lightning, inkling,
--      minimax-m3) put CoT in a separate reasoning_content field — content
--      stays clean, those are kept.
--    openai/gpt-oss-120b — 30s timeout on NIM free tier (gpt-oss-20b fine).
--    zen       x-preview-f-free / big-pickle — 24h live: 0/21 and 0/6 respectively
--    agnes     agnes-2.5-pro — 24h live: 0/24 (all calls fail)
--    orcarouter deepseek-v4-pro-free / tencent/hy3-free — 24h live: 0/6 and 0/8
--    openrouter z-ai/glm-5.2:free / gpt-oss-20b:free / laguna-s|xs-2.1:free /
--              nemotron-3.5-lightning:free / gemma-4-31b-it:free /
--              nemotron-nano-9b-v2:free  (:free catalog confirmed; daily free
--              quota exhausted at test time — enabled so they join the chain
--              after UTC reset)
--    kimi-k3 score 88→83: 24h live 60.3% success, 12.6s avg; minimax-m3 (85)
--      is faster and more reliable as top pick for take generation.
--
-- 2) DELETE rows whose model vanished from the provider's live catalog
--    (can never succeed again):
--    nvidia    llama-4-maverick / minimax-m2.7 / qwen3-next-80b-a3b /
--              phi-4-mini-instruct / deepseek-v4-flash (superseded by -0731)
--    openrouter gemma-2-9b-it:free / phi-4-mini-instruct:free /
--              qwen2.5-7b-instruct:free / deepseek-v4-flash:free /
--              mistral-7b-instruct:free
--    zen       longcat-2.0-free
--    freemodel gpt-5.5 / gpt-5.4 / gpt-5.4-mini / gpt-5.3-codex
--              (catalog replaced by gpt-5.6 family)
--
-- 3) freemodel account balance exhausted ("Insufficient balance" on all
--    calls): register new gpt-5.6-luna/sol/terra as enabled=0 for one-line
--    re-enable after top-up.

-- --- NVIDIA: add verified models ---
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type, context_size, max_output) VALUES
  ('nvidia','nvidia/nemotron-3-super-120b-a12b',95,1,'text',131072,4096),
  ('nvidia','openai/gpt-oss-120b',90,1,'text',131072,8192),
  ('nvidia','moonshotai/kimi-k3',83,1,'text',131072,4096),
  ('nvidia','minimaxai/minimax-m3',85,1,'text',131072,4096),
  ('nvidia','nvidia/nemotron-3.5-lightning-30b-a3b',82,1,'text',131072,4096),
  ('nvidia','openai/gpt-oss-20b',80,1,'text',131072,8192),
  ('nvidia','thinkingmachines/inkling',78,1,'text',131072,4096);

-- --- NVIDIA: disable reasoning models that break structured JSON tasks ---
UPDATE provider_models SET enabled = 0 WHERE provider='nvidia' AND model_id IN (
  'nvidia/nemotron-3-super-120b-a12b',
  'openai/gpt-oss-120b');

-- --- NVIDIA: delete catalog-dead rows ---
DELETE FROM provider_models WHERE provider='nvidia' AND model_id IN (
  'meta/llama-4-maverick-17b-128e-instruct',
  'minimaxai/minimax-m2.7',
  'qwen/qwen3-next-80b-a3b-instruct',
  'microsoft/phi-4-mini-instruct',
  'deepseek-ai/deepseek-v4-flash');

-- --- Zen: add verified free models ---
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type, context_size, max_output) VALUES
  ('zen','x-preview-f-free',85,0,'text',131072,4096),
  ('zen','big-pickle',80,0,'text',131072,4096);

-- --- Zen: delete catalog-dead row ---
DELETE FROM provider_models WHERE provider='zen' AND model_id='longcat-2.0-free';

-- --- Agnes: 2.5 generation (verified) ---
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type, context_size, max_output) VALUES
  ('agnes','agnes-2.5-flash',95,1,'text',131072,4096),
  ('agnes','agnes-2.5-pro',85,0,'text',131072,4096);
UPDATE provider_models SET enabled = 0 WHERE provider='agnes' AND model_id='agnes-2.0-flash' AND EXISTS (
  SELECT 1 FROM provider_models WHERE provider='agnes' AND model_id='agnes-2.5-flash');

-- --- OpenRouter: :free additions (catalog confirmed, specs from /models) ---
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type, context_size, max_output) VALUES
  ('openrouter','z-ai/glm-5.2:free',88,1,'text',256000,65536),
  ('openrouter','openai/gpt-oss-20b:free',82,1,'text',131072,32768),
  ('openrouter','poolside/laguna-s-2.1:free',78,1,'text',262144,32768),
  ('openrouter','nvidia/nemotron-3.5-lightning:free',76,1,'text',1000000,65536),
  ('openrouter','google/gemma-4-31b-it:free',74,1,'text',262144,32768),
  ('openrouter','poolside/laguna-xs-2.1:free',72,1,'text',262144,32768),
  ('openrouter','nvidia/nemotron-nano-9b-v2:free',70,1,'text',128000,8192);

-- --- OpenRouter: delete catalog-dead rows ---
DELETE FROM provider_models WHERE provider='openrouter' AND model_id IN (
  'google/gemma-2-9b-it:free',
  'microsoft/phi-4-mini-instruct:free',
  'qwen/qwen2.5-7b-instruct:free',
  'deepseek/deepseek-v4-flash:free',
  'mistralai/mistral-7b-instruct:free');

-- --- Freemodel: old GPT-5.x gone from catalog; register gpt-5.6 disabled ---
DELETE FROM provider_models WHERE provider='freemodel';
INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled, type, context_size, max_output) VALUES
  ('freemodel','gpt-5.6-luna',90,0,'text',131072,4096),
  ('freemodel','gpt-5.6-sol',85,0,'text',131072,4096),
  ('freemodel','gpt-5.6-terra',80,0,'text',131072,4096);

-- --- OrcaRouter: disable pre-existing dead rows (24h: 0/6, 0/8) ---
UPDATE provider_models SET enabled = 0 WHERE provider='orcarouter' AND model_id IN (
  'deepseek/deepseek-v4-pro-free',
  'tencent/hy3-free');

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '20');

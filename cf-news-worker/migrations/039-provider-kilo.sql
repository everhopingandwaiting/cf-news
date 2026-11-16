-- Migration 039: 新增 Kilo AI Gateway 供应商（kilo-auto/free 免费自动路由池）
-- Applied: 2026-11-17
--
-- 用户提供的 kilo.ai 账号 key（JWT，exp≈2033）。网关 OpenAI 兼容：
--   base_url = https://ai-gateway.kilo.ai/api/v1   （Bearer，无额外 header）
--   GET /models 免鉴权，实测 468 个模型，其中 :free 与 kilo-auto/* 共 14 个
--   kilo-auto/free：256k ctx，pricing=0，服务端自动路由到当前可用的免费模型
--     （实测两次分别落到 nvidia/nemotron-3-ultra-550b-a55b:free、同池另一模型）
-- 免费档限制（官方文档 / 第三方探测）：约 60 RPM、1000 RPD，按 IP/账号计。
--
-- 实测（2026-11-17 00:2x UTC，max_tokens=120，中文摘要 prompt）：
--   kilo-auto/free                        OK 1.8s  finish=stop  正常中文输出
--   kilo-auto/small                       OK 0.9s  finish=stop  （gemma-4-26b:free）
--   nvidia/nemotron-3.5-lightning:free    finish=length，content 为空（推理吃掉 token）
--   baidu/ernie-5.5-flash-preview:free    OK 1.4s  正常中文输出
-- 注意 max_tokens 太小（8）时 kilo-auto/free 会因推理 token 占满而返回空 content，
-- 摘要链路按每篇 120 token 预算（10 篇 = 1200），无此问题。
--
-- 插在 zhipu 之后、sensenova 之前：zhipu 实测有 429 code 1302 速率限制，
-- Kilo 的 60 RPM 池可作为第二梯队；sensenova/agnes 的 rpm/tpm 限制更紧。
--
-- 数据合规提示：kilo-auto/free 可能路由到会记录 prompt 的免费上游（含 NVIDIA
-- trial），只用于公开新闻摘要，不要放敏感数据。

INSERT OR IGNORE INTO providers (name, base_url, api_key_env, priority, enabled)
VALUES ('kilo', 'https://ai-gateway.kilo.ai/api/v1', 'KILO_API_KEY', 90, 1);

INSERT OR IGNORE INTO provider_models
  (provider, model_id, score, enabled, type, context_size, max_output, is_free)
VALUES ('kilo', 'kilo-auto/free', 90, 1, 'text', 256000, 8192, 1);

INSERT OR REPLACE INTO app_config (key, value) VALUES
  ('provider_order', 'zhipu,kilo,sensenova,agnes,cloudflare');

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '39');

-- Migration 040: 恢复 OpenCode Zen 供应商（免鉴权免费档，big-pickle 优先）
-- Applied: 2026-11-17
--
-- 038 曾把 zen 下线并删除 ZEN_API_KEY（用户要求：公共网关不配私有密钥）。事后实测
-- （2026-11-17 00:2x UTC，本机出口 IP）确认 zen 的免费模型**本来就免鉴权**：
--   GET  https://opencode.ai/zen/v1/models          → 200，87 个模型（12 个 -free）
--   POST .../chat/completions  big-pickle  无 Authorization → 429 FreeUsageLimitError
--        "Free usage limit reached. Free models work in OpenCode (https://opencode.ai)"
--   POST .../chat/completions  gpt-5.4-nano 无 Authorization → 401 Missing API key
-- 即：免费模型走匿名通道、按出口 IP 计额度；带旧 key（422d9d...）反而 401 Invalid credential，
-- 带 key 调付费模型 401 Missing API key。所以正确做法是 api_key_env=空串（不带 Authorization），
-- 而不是再要一把 key。
--
-- 额度按 IP 计：本机（家用 IP）实测已耗尽。生产实跑（2026-11-17 00:24-00:25 UTC，Worker 出口）
-- 同样恒返回 429 FreeUsageLimitError（~100ms 快速失败），四个免费模型无一例外 —— Cloudflare 出口
-- IP 与大量其他 Worker 共享，免费额度基本长期处于耗尽状态。故 zen 放在 zhipu 之后：zhipu 正常时
-- 完全不触达（零额外延迟），zhipu 429/失败时才轮到 zen，再兜底 kilo。实测 zhipu 首跳 1.3s 出摘要。
-- big-pickle 为推理模型，max_tokens 过小时 content 可能为空；摘要链路按 120-300 token 预算，
-- 且 doOpenAICompat 30s 超时对推理模型偏紧，故 max_output 给 8192（实际受 summary_max_tokens 限制）。
--
-- 顺带修 aiProvider：空 api_key_env 不再被 getProviderInfo 拦掉；无 key 时 403 不触发
-- markProviderKeyFailed（免鉴权 provider 没有 key 可失效，403 只是网关风控）。

INSERT OR REPLACE INTO providers (name, base_url, api_key_env, priority, enabled)
VALUES ('zen', 'https://opencode.ai/zen/v1', '', 95, 1);

INSERT OR REPLACE INTO provider_models
  (provider, model_id, score, enabled, type, context_size, max_output, is_free)
VALUES
  ('zen', 'big-pickle',                  100, 1, 'text', 200000, 8192, 1),
  ('zen', 'deepseek-v4.1-flash-free',     98, 1, 'text', 131072, 8192, 1),
  ('zen', 'glm-5.3-flash-free',           96, 1, 'text', 131072, 8192, 1),
  ('zen', 'mimo-v2.6-flash-free',         94, 1, 'text', 131072, 8192, 1);

INSERT OR REPLACE INTO app_config (key, value) VALUES
  ('provider_order', 'zhipu,zen,kilo,sensenova,agnes,cloudflare');

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '40');

-- Migration 038: 供应商链路按 2026-11-17 实测重排；Zen 密钥下线
-- Applied: 2026-11-17
--
-- 触发：链路里 zhipu 连续 5 天零调用（ai_call_log 无记录），摘要全部挤在
-- sensenova/cloudflare/agnes 上（后者 3 天 315 次 1015 限流失败）。
--
-- 2026-11-17 逐个带真实 key 实测（POST {base}/chat/completions，max_tokens=8）：
--   zhipu      glm-4-flash-250414   OK 0.5s           ← 活着，但在 provider_models 里被禁用了
--   zhipu      glm-5.2 / 5.3-flash  429 余额不足或无可用资源包（1113）
--   zhipu      glm-4.7-flash        429 该模型当前访问量过大（1305）
--   sensenova  deepseek-v4-flash    (生产侧 5 天 2143 ok，有 tpm/rpm 限制与偶发超时)
--   agnes      agnes-3.0-flash      OK 1.9s，但 429 error code 1015 频繁（3 天 315 次失败）
--   nvidia     google/gemma-4-31b-it 25s 超时（3 天 105 次失败，20 次成功）
--   openrouter :free 模型            404 已转为付费 slug（免费额度不可用）
--   groq       llama-3.3-70b        403 Forbidden
--   freemodel                       401 Insufficient balance
--   orcarouter                      401 密钥已被重置（需到 console 取新 key）
--   zen                              403 error 1010（Cloudflare 拦截）；用户确认该网关可公共使用、
--                                    不应带我们的 key → ZEN_API_KEY 已从 Worker secret / .env /
--                                    deploy.yml 中移除，providers.enabled=0
--   mango                            key 已于 2026-05-31 到期（providers.enabled 早已 0）
--
-- 链路改为 zhipu → sensenova → agnes → cloudflare：
--   之前 agnes 排在 sensenova 前，实测 agnes 的 1015 限流最凶、反使摘要延迟增大；
--   cloudflare 的 10k neurons/日免费额度中午前后就打光（4006），只能兜底。
--   nvidia / openrouter / freemodel / orcarouter 不在链路上，但仍留在 providers 表
--   （catalog 同步继续跑，恢复后可用 provider_order 配置随时加回）。

INSERT OR REPLACE INTO app_config (key, value) VALUES
  ('provider_order', 'zhipu,sensenova,agnes,cloudflare');

-- 恢复 zhipu 主力模型（曾因瞬时探测失败被 evidence pruning 禁用，实测 0.5s 可用）
UPDATE provider_models SET enabled = 1, score = 92
  WHERE provider = 'zhipu' AND model_id = 'glm-4-flash-250414';

-- Zen：密钥已删除，provider 下线
UPDATE providers SET enabled = 0 WHERE name = 'zen';

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '38');

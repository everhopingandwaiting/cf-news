-- Migration 033: 摘要链路按实测可用性重排（Cloudflare 额度耗尽降级）
-- Applied: 2026-10-31
--
-- 背景：031 把 cloudflare llama-3.3-70b 提到链路首位后，20 分钟内跑了 141 次批量摘要，
-- 直接把 Workers AI 免费额度（10,000 neurons/天，账号级、与去重 embedding / AI Search
-- 上传共享）烧穿。08:10 UTC 起全部调用返回：
--   AiError 4006: you have used up your daily free allocation of 10,000 neurons
-- 也就是说 cloudflare 只能承担 ~100 个批量摘要/天，做主力必然在当天早段就打光，
-- 还会连累去重 embedding。降级为兜底。
--
-- 同时其它 provider 的实测（2026-10-31 08:20 UTC，带真实 key 逐个打通）：
--   zhipu      glm-4-flash-250414   OK 0.7s，连发 3 次均成功   ← 启用为主力
--   zhipu      glm-4.7-flash        429 该模型当前访问量过大
--   zhipu      glm-5.3-flash        429 余额不足
--   agnes      agnes-3.0-flash      OK 1.2s（偶发 429 限流）
--   sensenova  deepseek-v4-flash    429 insufficient_quota / BurstRate
--   openrouter poolside/laguna-s-2.1:free  429 free-models-per-day 用尽（每日重置）
--   nvidia     *                   410 Gone（全部模型下线）
--   freemodel  gpt-5.6-luna        401 Insufficient balance
--   zen        *-free              403 error 1010（Cloudflare 拦截）
--   orcarouter deepseek/*-free     429/402 免费额度需达标账户 / 已用尽
--
-- 结论：链路顺序按"当前真实可用"排，cloudflare 退到最后（额度恢复后仍可兜底）。

INSERT OR IGNORE INTO provider_models
  (provider, model_id, score, enabled, type, context_size, max_output, is_free)
VALUES
  ('zhipu', 'glm-4-flash-250414', 92, 1, 'text', 131072, 4096, 1);

-- 已存在的条目：显式启用并给主力分（高于 agnes-3.0-flash 的 85）
UPDATE provider_models SET enabled = 1, score = 92
  WHERE provider = 'zhipu' AND model_id = 'glm-4-flash-250414';

INSERT OR REPLACE INTO app_config (key, value) VALUES
  ('provider_order', 'zhipu,agnes,sensenova,openrouter,cloudflare,nvidia,freemodel,zen,orcarouter');

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '33');

-- Migration 031: 摘要链路上的供应商链路调整（2026-10-31 实测）
-- Applied: 2026-10-31
--
-- 背景：近 7 天摘要只有 openrouter(poolside/laguna:free) 与 sensenova(deepseek-v4-flash)
-- 两个模型在跑，前者免费额度天天 429、后者 TPM 打满，摘要只有 ~54% 覆盖率。
-- 逐家实测（本机 + Workers 网络 + 生产日志）结论：
--
--   cloudflare   Workers AI binding 正常，llama-3.3-70b-fp8-fast 实测 55 次成功、平均 1.2s、
--                无 429 → 重新启用并放到链首（迁移 012 也确认过它是 Workers AI 唯一健康模型）
--   groq         /models 与 chat 全部 403（key 失效），provider 已被自动冻结 7 天 → 移出链路
--   nvidia       /models 列 85 个，但抽查 gpt-oss-120b / llama-3.3-70b / llama-3.1-8b /
--                kimi-k3 / minimax-m3 / mistral-large 全是 410 Gone（厂商下线）或 404
--                → 留在链尾，靠 modelRefresher 探针自愈，不再人工启用
--   mango        provider 已于 2026-05-31 过期（enabled=0）→ 移出链路
--   sensenova    可用但限流，放到第二位
--   openrouter   免费模型 429 频发，放第三位（失败才回落）

-- cloudflare：Workers AI 唯一确认健康的生成模型（行可能不存在时补建）
INSERT OR IGNORE INTO provider_models
  (provider, model_id, score, enabled, type, context_size, max_output, is_free)
VALUES
  ('cloudflare', '@cf/meta/llama-3.3-70b-instruct-fp8-fast', 120, 1, 'text', 131072, 4096, 0);
UPDATE provider_models SET enabled = 1
  WHERE provider = 'cloudflare' AND model_id = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

-- groq：key 403，先关掉条目；key 修好后 modelRefresher 的探针会自动重新启用
UPDATE provider_models SET enabled = 0
  WHERE provider = 'groq' AND model_id = 'llama-3.3-70b-versatile';

-- 链路顺序：能用的在前，免费/限流/下线风险的在后面
INSERT OR REPLACE INTO app_config (key, value) VALUES
  ('provider_order', 'cloudflare,sensenova,openrouter,nvidia,freemodel,agnes,zen,orcarouter,zhipu');

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '31');

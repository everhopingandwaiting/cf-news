-- Migration 032: Agnes 模型目录对齐 + 启用实测可用的 agnes-3.0-flash
-- Applied: 2026-10-31
--
-- 背景：modelRefresher 一次 run 跑完所有 provider，前两家就耗尽 invocation 时间，
-- agnes 自 2026-10-16 起没再被同步（详见 migration 后的 code fix：游标轮转）。
-- 2026-10-31 直接取 https://apihub.agnes-ai.com/v1/models，线上只剩 9 个：
--   text : agnes-2.5-flash / agnes-2.5-pro-alpha / agnes-2.5-pro-beta / agnes-3.0-flash
--   image: agnes-image-2.0-flash / agnes-image-2.1-flash / agnes-image-2.5-flash
--   video: agnes-video-2.5 / agnes-video-2.5-flash
--
-- 逐个实测（本机带 AGNES_API_KEY）：
--   agnes-3.0-flash       OK 1.1s  ← 启用
--   agnes-2.5-flash       OK 5.9s（慢，留作候选）
--   agnes-2.5-pro-alpha   403 Insufficient user quota（余额 -$0.000378）
--   agnes-2.5-pro-beta    403 Insufficient user quota
--
-- 目录里有、厂商已下线的 6 个直接删除（enabled 本来就恒为 0，留着只会误导人工排查）

DELETE FROM provider_models WHERE provider = 'agnes' AND model_id IN (
  'agnes-1.5-flash',
  'agnes-2.0-flash',
  'agnes-2.5-pro',
  'agnes-3.0-flash-max',
  'agnes-3.0-pro',
  'agnes-video-v2.0'
);

-- 补齐线上新增的 3 个（图片/视频类：本站不走，入目录但保持禁用）
INSERT OR IGNORE INTO provider_models
  (provider, model_id, score, enabled, type, context_size, max_output, is_free)
VALUES
  ('agnes', 'agnes-image-2.5-flash', 60, 0, 'image', 131072, 4096, 0),
  ('agnes', 'agnes-video-2.5',       60, 0, 'video', 131072, 4096, 0),
  ('agnes', 'agnes-video-2.5-flash', 60, 0, 'video', 131072, 4096, 0);

-- 启用实测最快可用的文本模型（score 85：低于 cloudflare 70b 的 120，高于探针基线 60）
UPDATE provider_models SET enabled = 1, score = 85
  WHERE provider = 'agnes' AND model_id = 'agnes-3.0-flash';

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '32');

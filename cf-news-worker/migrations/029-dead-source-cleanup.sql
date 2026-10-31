-- Migration 029: 清理长期零产出的 RSS 源 + 修复 36氪 订阅地址
-- Applied: 2026-10-31
--
-- 背景：47 个启用源里有 8 个近 7 天零产出，且 error_count 恒为 0（解析成功、条目为 0），
-- 站内健康检查完全看不到。2026-10-31 逐个实测（Workers 网络 + 本机双跑）后：
--
--   36氪          https://36kr.com/feed 返回 HTML(SPA)，带 www 的地址仍返回 RSS → 改地址
--   人民网国际    feed 冻结在 2025-06-05（一年多未更新）→ 停用
--   The Mainichi  源站超时（Workers 与本机均超时）→ 停用
--   丁香园        feed 冻结在 2025-08-29（条目最早 2023）→ 停用
--   ESPN          返回 202 + HTML（反爬挑战页），不是 feed → 停用
--   Yahoo Finance 源站 403 → 停用
--   知乎热榜      第三方镜像自 2026-07-06 起未更新，20 条 URL 全在归档库 → 停用
--   澎湃新闻      镜像仍在更新，条目被去重/入库环节吞掉，另行排查（本迁移不动）

-- 36氪：https://36kr.com/feed 已变成 HTML 页面，www 子域仍返回 application/rss+xml（30 条）
UPDATE news_sources SET feed_url = 'https://www.36kr.com/feed' WHERE feed_url = 'https://36kr.com/feed';

-- 死源停用（按 id 精确匹配，避免重名误伤）
UPDATE news_sources SET enabled = 0 WHERE id = 71;   -- 人民网国际 feed 冻结 2025-06
UPDATE news_sources SET enabled = 0 WHERE id = 78;   -- The Mainichi 超时
UPDATE news_sources SET enabled = 0 WHERE id = 91;   -- 丁香园 feed 冻结 2025-08
UPDATE news_sources SET enabled = 0 WHERE id = 94;   -- ESPN 202 反爬页
UPDATE news_sources SET enabled = 0 WHERE id = 106;  -- Yahoo Finance 403
UPDATE news_sources SET enabled = 0 WHERE id = 69;   -- 知乎热榜 镜像冻结 2026-07

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '29');

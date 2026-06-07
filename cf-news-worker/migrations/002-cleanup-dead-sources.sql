-- Migration 002: Clean up dead RSS sources and add working replacements
-- Applied: 2026-06-07
-- 
-- Changes:
--   1. Add FT中文网 as finance source (replaces 华尔街见闻)
--   2. Disable 第一财经 (dead RSS bridge, no replacement)
--   3. Add CarNewsChina as auto source (replaces 搜狐汽车)
--   4. Disable Motor1 (404), 中华网军事 (404), Mayo Clinic News (403)
--   5. Disable MarkTechPost (Worker returns 202), WSJ Markets (not RSS)
--   6. Disable 东方财富快讯 (duplicate of fund source 109), 凤凰网财经/理财 (empty)
--   7. Enable 人民网国际 as military source

-- FT中文网 (replaces 华尔街见闻 id=84)
UPDATE news_sources SET feed_url = 'https://www.ftchinese.com/rss/news', name = 'FT中文网', url = 'https://www.ftchinese.com', category = 'finance', language = 'zh' WHERE id = 84;

-- 第一财经: feed dead → disable
UPDATE news_sources SET enabled = 0 WHERE id = 85;

-- 搜狐汽车 → CarNewsChina
UPDATE news_sources SET feed_url = 'https://carnewschina.com/feed/', category = 'auto', language = 'en', name = 'CarNewsChina', url = 'https://carnewschina.com' WHERE id = 95;
UPDATE news_sources SET enabled = 0 WHERE id = 96;  -- Motor1 404
UPDATE news_sources SET enabled = 0 WHERE id = 97;  -- 中华网军事 404

UPDATE news_sources SET enabled = 1, category = 'military' WHERE id = 71;  -- 人民网国际

UPDATE news_sources SET enabled = 0 WHERE id = 92;  -- Mayo Clinic 403
UPDATE news_sources SET enabled = 0 WHERE id = 102; -- MarkTechPost 202

UPDATE news_sources SET enabled = 0 WHERE id = 105; -- WSJ Markets not RSS
UPDATE news_sources SET enabled = 0 WHERE id = 107; -- 凤凰网财经 empty
UPDATE news_sources SET enabled = 0 WHERE id = 108; -- 东方财富快讯 dup
UPDATE news_sources SET enabled = 0 WHERE id = 110; -- 凤凰网 理财 empty

-- Track migration version
INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '2');

-- Migration 030: 停用 36氪（Cloudflare 出口被反爬挑战页挡住）
-- Applied: 2026-10-31
--
-- 029 把订阅地址改成 https://www.36kr.com/feed（本机取是 application/rss+xml，30 条），
-- 但从 Workers 网络实测：直连返回 200 text/html 的挑战页；改走 Browser Rendering 后
-- 解析依旧 0 条（fetchWithBrowser 拿回的仍是 HTML）。即该站对 Cloudflare 出口整体封禁，
-- 站内没有办法拿到 RSS。留一个永远 0 条的源只会继续污染"源健康"判断。
--
-- 恢复条件：找到可从 Cloudflare 访问的 36氪 镜像/桥接地址后，改 feed_url 再 enabled=1。

UPDATE news_sources SET enabled = 0 WHERE id = 2;

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '30');

-- 027: kv_cache 表 + 新闻总数计数器种子。
-- 计数器给 /api/news 默认列表的 total 用：迁移时按真实 COUNT 初始化（避免部署后
-- 首个 TTL 窗口内返回 0），此后由 saveNewsItems 增量维护，TTL 到期后路由侧
-- remember() 自动重算回填（自愈）。

CREATE TABLE IF NOT EXISTS kv_cache (
    cache_key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    expires_at INTEGER NOT NULL DEFAULT 0
);

INSERT OR REPLACE INTO kv_cache (cache_key, value, expires_at)
VALUES (
    'news_items_active_count',
    (SELECT COUNT(*) FROM news_items WHERE is_deleted = 0),
    strftime('%s', 'now') + 3600
);

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '27');
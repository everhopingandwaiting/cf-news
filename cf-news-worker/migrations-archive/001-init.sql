-- 归档库初始化（cf-news-archive）— 冷热分库方案 C 的归档侧 schema
-- 内容域子集：与主库 news 内容域同名同构（含全部 news_items 索引），
-- 但**不含**用户/运营表（favorites/history/comments/kv_cache/ai_call_log 等永驻主库）。
-- news_sources 纳入归档（列表 JOIN 需要），由 evictBatch 每次驱逐前同步。
-- 版本跟踪同样走 app_config.schema_version（migrate.sh 统一逻辑）。
CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS news_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    url TEXT,
    feed_url TEXT NOT NULL,
    category TEXT DEFAULT 'news',
    language TEXT DEFAULT 'zh',
    source_type TEXT DEFAULT 'rss',
    enabled INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 99,
    last_fetched_at TEXT,
    last_fetched_count INTEGER DEFAULT 0,
    error_count INTEGER DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_feed_url ON news_sources(feed_url);

CREATE TABLE IF NOT EXISTS news_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    url TEXT NOT NULL UNIQUE,
    description TEXT,
    content TEXT,
    image_url TEXT,
    category TEXT DEFAULT 'general',
    published_at DATETIME,
    is_deleted INTEGER DEFAULT 0,
    deleted_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ai_search_uploaded INTEGER DEFAULT 0,
    dedup_hash TEXT,
    summary_pending INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_news_items_source ON news_items(source_id);
CREATE INDEX IF NOT EXISTS idx_news_items_category ON news_items(category);
CREATE INDEX IF NOT EXISTS idx_news_items_published ON news_items(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_items_created ON news_items(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_items_list ON news_items(is_deleted, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_items_cat_created ON news_items(is_deleted, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_items_src_created ON news_items(is_deleted, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_dedup_hash ON news_items(dedup_hash);
CREATE INDEX IF NOT EXISTS idx_news_items_pending ON news_items(summary_pending, created_at DESC);

CREATE TABLE IF NOT EXISTS news_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    news_id INTEGER UNIQUE NOT NULL,
    summary TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    illustration_url TEXT
);
CREATE TABLE IF NOT EXISTS news_ai_take (
    news_id INTEGER PRIMARY KEY,
    take TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS news_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    news_id INTEGER NOT NULL,
    entity_type TEXT NOT NULL,
    entity_value TEXT NOT NULL,
    entity_context TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_news_entities_news ON news_entities(news_id);
CREATE INDEX IF NOT EXISTS idx_news_entities_type ON news_entities(entity_type);
CREATE TABLE IF NOT EXISTS news_perspectives (
    news_id INTEGER PRIMARY KEY,
    related_ids TEXT NOT NULL,
    perspective TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- FTS5 与主库同构（rowid 对齐 news_items.id，驱逐时整行迁移）
CREATE VIRTUAL TABLE IF NOT EXISTS news_fts USING fts5(title, description, tokenize='unicode61');

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '1');

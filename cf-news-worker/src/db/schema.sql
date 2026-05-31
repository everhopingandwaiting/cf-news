-- Cloudflare D1 Database Schema for News Worker

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    username TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 新闻源表
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
    error_count INTEGER DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_feed_url ON news_sources(feed_url);

-- 新闻条目表
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
    FOREIGN KEY (source_id) REFERENCES news_sources(id)
);

-- AI Search 上传标记
ALTER TABLE news_items ADD COLUMN ai_search_uploaded INTEGER DEFAULT 0;

-- 用户收藏表
CREATE TABLE IF NOT EXISTS user_favorites (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    news_id INTEGER NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    deleted_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (news_id) REFERENCES news_items(id),
    UNIQUE(user_id, news_id)
);

-- 用户阅读历史表
CREATE TABLE IF NOT EXISTS user_read_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    news_id INTEGER NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    deleted_at DATETIME,
    read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (news_id) REFERENCES news_items(id),
    UNIQUE(user_id, news_id)
);

-- 新闻评论表
CREATE TABLE IF NOT EXISTS news_comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    news_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    deleted_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (news_id) REFERENCES news_items(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 新闻摘要表
CREATE TABLE IF NOT EXISTS news_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    news_id INTEGER UNIQUE NOT NULL,
    summary TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (news_id) REFERENCES news_items(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_news_items_source ON news_items(source_id);
CREATE INDEX IF NOT EXISTS idx_news_items_category ON news_items(category);
CREATE INDEX IF NOT EXISTS idx_news_items_published ON news_items(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_items_created ON news_items(created_at DESC);
-- 复合索引：覆盖 is_deleted + 排序和常用过滤组合
CREATE INDEX IF NOT EXISTS idx_news_items_list ON news_items(is_deleted, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_items_cat_created ON news_items(is_deleted, category, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_news_items_src_created ON news_items(is_deleted, source_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_favorites_user ON user_favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_user_read_history_user ON user_read_history(user_id);
CREATE INDEX IF NOT EXISTS idx_news_comments_news ON news_comments(news_id);
CREATE INDEX IF NOT EXISTS idx_news_comments_user ON news_comments(user_id);

-- 插入默认新闻源 (中文优先)
INSERT OR IGNORE INTO news_sources (name, url, feed_url, category, language) VALUES
    ('36氪', 'https://36kr.com', 'https://36kr.com/feed', 'tech', 'zh'),
    ('少数派', 'https://sspai.com', 'https://sspai.com/feed', 'tech', 'zh'),
    ('IT之家', 'https://ithome.com', 'https://www.ithome.com/rss/', 'tech', 'zh'),
    ('澎湃新闻', 'https://www.thepaper.cn', 'https://www.thepaper.cn/rss_newsDetail_wap.jsp', 'news', 'zh'),
    ('Hacker News', 'https://news.ycombinator.com', 'https://hnrss.org/frontpage', 'tech', 'en'),
    ('TechCrunch', 'https://techcrunch.com', 'https://techcrunch.com/feed/', 'tech', 'en'),
    ('The Verge', 'https://theverge.com', 'https://www.theverge.com/rss/index.xml', 'tech', 'en'),
    ('Ars Technica', 'https://arstechnica.com', 'https://feeds.arstechnica.com/arstechnica/index', 'tech', 'en'),
    ('Reuters', 'https://reuters.com', 'https://www.reutersagency.com/feed/', 'news', 'en'),
    ('BBC News', 'https://bbc.com/news', 'https://feeds.bbci.co.uk/news/rss.xml', 'news', 'en'),
    ('机器之心', 'https://www.jiqizhixin.com', 'https://www.jiqizhixin.com/rss', 'ai', 'zh'),
    ('量子位', 'https://www.qbitai.com', 'https://www.qbitai.com/feed', 'ai', 'zh'),
    ('AI 前线', 'https://www.infoq.cn', 'https://www.infoq.cn/feed', 'ai', 'zh'),
    ('OpenAI Blog', 'https://openai.com/blog', 'https://openai.com/blog/rss.xml', 'ai', 'en'),
    ('Hugging Face Blog', 'https://huggingface.co/blog', 'https://huggingface.co/blog/feed.xml', 'ai', 'en'),
    ('Google AI Blog', 'https://ai.googleblog.com', 'https://blog.research.google/feeds/posts/default', 'ai', 'en'),
    ('DeepMind Blog', 'https://deepmind.google/discover/blog', 'https://deepmind.google/blog/rss.xml', 'ai', 'en'),
    ('Anthropic News', 'https://anthropic.com/news', 'https://raw.githubusercontent.com/alan-turing-institute/ai-rss-feeds/refs/heads/main/feeds/anthropic-news.xml', 'ai', 'en'),
    ('爱范儿', 'https://ifanr.com', 'https://www.ifanr.com/feed', 'tech', 'zh'),
    ('NPR', 'https://npr.org', 'https://feeds.npr.org/1001/rss.xml', 'news', 'en'),
    ('Wired', 'https://wired.com', 'https://www.wired.com/feed/rss', 'tech', 'en');
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY,
    receive_digest INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
-- AI 调用记录表
CREATE TABLE IF NOT EXISTS ai_call_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    news_id INTEGER,
    prompt_length INTEGER,
    response_length INTEGER,
    success INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Provider 配置表（模型管理）
CREATE TABLE IF NOT EXISTS providers (
    name TEXT PRIMARY KEY,
    base_url TEXT NOT NULL,
    api_key_env TEXT,
    priority INTEGER DEFAULT 99,
    enabled INTEGER DEFAULT 1,
    expires_at TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 应用配置表
CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

-- 为已有表添加 source_type 列（幂等）
ALTER TABLE news_sources ADD COLUMN source_type TEXT DEFAULT 'rss';

-- 澎湃新闻（微信公众号版，通过第三方 RSS 桥）
INSERT OR IGNORE INTO news_sources (name, url, feed_url, category, language, source_type, sort_order)
VALUES ('澎湃新闻', 'https://www.thepaper.cn', 'https://decemberpei.cyou/rssbox/wechat-pengpaixinwen.xml', 'news', 'zh', 'rss', 50);

-- 知乎热榜（通过第三方 RSS 桥）
INSERT OR IGNORE INTO news_sources (name, url, feed_url, category, language, source_type, sort_order)
VALUES ('知乎热榜', 'https://www.zhihu.com', 'https://decemberpei.cyou/rssbox/zhihu.xml', 'tech', 'zh', 'rss', 60);

-- Provider 模型评分表
CREATE TABLE IF NOT EXISTS provider_models (
    provider TEXT NOT NULL,
    model_id TEXT NOT NULL,
    score INTEGER DEFAULT 50,
    enabled INTEGER DEFAULT 1,
    PRIMARY KEY (provider, model_id)
);

-- Neuron 使用量追踪
CREATE TABLE IF NOT EXISTS neuron_usage (
    date TEXT PRIMARY KEY,
    count INTEGER DEFAULT 0
);

-- FTS5 全文搜索索引（替代 KV 搜索索引，避免 KV 写入配额超限）
CREATE VIRTUAL TABLE IF NOT EXISTS news_fts USING fts5(
    title, description, tokenize='unicode61'
);

-- 今日要闻表
CREATE TABLE IF NOT EXISTS daily_digests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    content TEXT NOT NULL,
    news_ids TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

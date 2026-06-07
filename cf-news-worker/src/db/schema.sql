-- Cloudflare D1 Database Schema for News Worker

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    username TEXT,
    role TEXT DEFAULT 'user',
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
    last_fetched_count INTEGER DEFAULT 0,
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

-- 去重哈希列
ALTER TABLE news_items ADD COLUMN dedup_hash TEXT;

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

-- AI 小编吐槽表
CREATE TABLE IF NOT EXISTS news_ai_take (
    news_id INTEGER PRIMARY KEY,
    take TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (news_id) REFERENCES news_items(id) ON DELETE CASCADE
);

-- 多视角对比表
CREATE TABLE IF NOT EXISTS news_perspectives (
    news_id INTEGER PRIMARY KEY,
    related_ids TEXT NOT NULL,
    perspective TEXT NOT NULL,
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

-- 插入默认新闻源 (按类别排序)
INSERT OR IGNORE INTO news_sources (name, url, feed_url, category, language) VALUES
    ('36氪', 'https://36kr.com', 'https://36kr.com/feed', 'tech', 'zh'),
    ('少数派', 'https://sspai.com', 'https://sspai.com/feed', 'tech', 'zh'),
    ('IT之家', 'https://ithome.com', 'https://www.ithome.com/rss/', 'tech', 'zh'),
    ('Hacker News', 'https://news.ycombinator.com', 'https://hnrss.org/frontpage', 'tech', 'en'),
    ('TechCrunch', 'https://techcrunch.com', 'https://techcrunch.com/feed/', 'tech', 'en'),
    ('The Verge', 'https://theverge.com', 'https://www.theverge.com/rss/index.xml', 'tech', 'en'),
    ('Ars Technica', 'https://arstechnica.com', 'https://feeds.arstechnica.com/arstechnica/index', 'tech', 'en'),
    ('爱范儿', 'https://ifanr.com', 'https://www.ifanr.com/feed', 'tech', 'zh'),
    ('阮一峰的网络日志', 'https://www.ruanyifeng.com/blog', 'https://www.ruanyifeng.com/blog/atom.xml', 'tech', 'zh'),
    ('V2EX', 'https://www.v2ex.com', 'https://www.v2ex.com/index.xml', 'tech', 'zh'),
    ('BBC News', 'https://bbc.com/news', 'https://feeds.bbci.co.uk/news/rss.xml', 'news', 'en'),
    ('Reuters', 'https://reuters.com', 'https://www.reuters.com/arc/outboundfeeds/news/', 'news', 'en'),
    ('NPR', 'https://npr.org', 'https://feeds.npr.org/1001/rss.xml', 'news', 'en'),
    ('Kyodo News English', 'https://english.kyodonews.net', 'https://english.kyodonews.net/rss/all.xml', 'news', 'en'),
    ('The Mainichi English', 'https://mainichi.jp/english', 'https://www.mainichi.jp/rss/etc/english_latest.rss', 'news', 'en'),
    ('Yonhap News English', 'https://en.yna.co.kr', 'https://en.yna.co.kr/RSS/news.xml', 'news', 'en'),
    ('Korea JoongAng Daily', 'https://koreajoongangdaily.joins.com', 'https://koreajoongangdaily.joins.com/feed', 'news', 'en'),  -- disabled: feed dead
    ('The Japan Times', 'https://japantimes.co.jp', 'https://www.japantimes.co.jp/feed/', 'news', 'en'),
    ('澎湃新闻', 'https://www.thepaper.cn', 'https://www.thepaper.cn/rss_newsDetail_wap.jsp', 'news', 'zh'),
    ('联合早报', 'https://www.zaobao.com', 'https://www.zaobao.com/realtime/china/feed', 'news', 'zh'),
    ('人民网国际', 'https://www.people.com.cn', 'http://www.people.com.cn/rss/world.xml', 'military', 'zh'),
    ('量子位', 'https://www.qbitai.com', 'https://www.qbitai.com/feed', 'ai', 'zh'),
    ('AI 前线', 'https://www.infoq.cn', 'https://www.infoq.cn/feed', 'ai', 'zh'),
    ('OpenAI Blog', 'https://openai.com/blog', 'https://openai.com/blog/rss.xml', 'ai', 'en'),
    ('MIT Technology Review AI', 'https://www.technologyreview.com/topic/artificial-intelligence', 'https://www.technologyreview.com/topic/artificial-intelligence/feed/', 'ai', 'en'),
    ('Simon Willison', 'https://simonwillison.net', 'https://simonwillison.net/atom/everything/', 'ai', 'en'),
    ('世纪新能源网', 'https://www.ne21.com', 'https://www.ne21.com/feed/', 'energy', 'zh'),  -- disabled: no real RSS
    ('CnEVPost', 'https://cnevpost.com', 'https://cnevpost.com/feed/', 'energy', 'en'),
    ('FT中文网', 'https://www.ftchinese.com', 'https://www.ftchinese.com/rss/news', 'finance', 'zh'),
    ('Bloomberg Markets', 'https://www.bloomberg.com/markets', 'https://feeds.bloomberg.com/markets/news.rss', 'finance', 'en'),
    ('游戏研究社', 'https://www.yystv.cn', 'https://www.yystv.cn/rss/feed', 'entertainment', 'zh'),
    ('独立鱼电影', 'https://duliyu.com', 'https://decemberpei.cyou/rssbox/wechat-duliyudianying.xml', 'entertainment', 'zh'),
    ('果壳网 科学人', 'https://www.guokr.com', 'https://plink.anyfeeder.com/guokr/scientific', 'science', 'zh'),
    ('New Scientist', 'https://www.newscientist.com', 'https://www.newscientist.com/feed/home', 'science', 'en'),
    ('丁香园', 'https://www.dxy.cn', 'https://www.dxy.cn/rss/q/2.0/channel/12', 'health', 'zh'),
    ('虎扑综合体育', 'https://www.hupu.com', 'https://decemberpei.cyou/rssbox/hupu-240.xml', 'sports', 'zh'),
    ('ESPN', 'https://www.espn.com', 'https://www.espn.com/espn/rss/news', 'sports', 'en'),
    ('CarNewsChina', 'https://carnewschina.com', 'https://carnewschina.com/feed/', 'auto', 'en'),
    ('Defense News', 'https://www.defensenews.com', 'https://www.defensenews.com/arc/outboundfeeds/rss/', 'military', 'en'),
    ('品玩 PingWest', 'https://www.pingwest.com', 'https://decemberpei.cyou/rssbox/pingwest.xml', 'tech', 'zh'),
    ('端传媒', 'https://theinitium.com', 'http://feeds.initium.news/theinitium', 'news', 'zh'),  -- disabled: feed dead
    ('纽约时报中文', 'https://cn.nytimes.com', 'https://cn.nytimes.com/rss/', 'news', 'zh'),
    ('Seeking Alpha', 'https://seekingalpha.com', 'https://seekingalpha.com/tag/editors-picks.xml', 'stocks', 'en'),
    ('MarketWatch', 'https://www.marketwatch.com', 'https://www.marketwatch.com/rss/topstories', 'stocks', 'en'),
    ('Yahoo Finance', 'https://finance.yahoo.com', 'https://finance.yahoo.com/news/rssindex', 'stocks', 'en'),
    ('The Guardian', 'https://www.theguardian.com', 'https://www.theguardian.com/world/rss', 'news', 'en'),
    ('东方财富 策略研报', 'https://data.eastmoney.com/report/stock/strategy.html', 'https://rss.eastmoney.com/rss_partener.xml', 'funds', 'zh'),
    ('雪球 今日话题', 'https://xueqiu.com', 'https://xueqiu.com/hots/topic/rss', 'stocks', 'zh');
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
VALUES ('知乎热榜', 'https://www.zhihu.com', 'https://decemberpei.cyou/rssbox/zhihu.xml', 'news', 'zh', 'rss', 60);

-- 人民日报（微信公众号版，通过第三方 RSS 桥）
INSERT OR IGNORE INTO news_sources (name, url, feed_url, category, language, source_type, sort_order)
VALUES ('人民日报', 'https://www.people.com.cn', 'https://decemberpei.cyou/rssbox/wechat-renminribao.xml', 'news', 'zh', 'rss', 55);

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

-- Push notification subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL,
    p256dh_key TEXT NOT NULL,
    auth_key TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, endpoint)
);

-- Trending topics hourly aggregation
CREATE TABLE IF NOT EXISTS trending_topics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keyword TEXT NOT NULL,
    date_hour TEXT NOT NULL,
    count INTEGER DEFAULT 1,
    UNIQUE(keyword, date_hour)
);
CREATE INDEX IF NOT EXISTS idx_trending_topics_hour ON trending_topics(date_hour DESC);
CREATE INDEX IF NOT EXISTS idx_trending_topics_keyword ON trending_topics(keyword);

-- 停用词表（来源：SMART IR + 哈工大+川大+百度中文停用词 + HTML残留词）
CREATE TABLE IF NOT EXISTS stop_words (
    word TEXT PRIMARY KEY,
    source TEXT NOT NULL DEFAULT 'unknown'
);

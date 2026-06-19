-- Reuters discontinued public RSS feeds (~2020). Replace with CNBC Top News.
UPDATE news_sources
SET name = 'CNBC',
    url = 'https://www.cnbc.com',
    feed_url = 'https://www.cnbc.com/id/100003114/device/rss/rss.html',
    category = 'news',
    language = 'en'
WHERE id = 8;

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '9');

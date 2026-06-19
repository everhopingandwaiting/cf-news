-- Add JSON Feed format sources (https://www.jsonfeed.org/version/1.1/)
-- Use explicit high id to avoid conflicts with test seed data
INSERT OR IGNORE INTO news_sources (id, name, url, feed_url, category, language, source_type, sort_order)
VALUES
    (9999, 'Daring Fireball', 'https://daringfireball.net', 'https://daringfireball.net/feeds/json', 'tech', 'en', 'json', 50);

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '8');

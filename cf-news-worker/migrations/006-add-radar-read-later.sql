-- User read-later list and keyword radar
CREATE TABLE IF NOT EXISTS user_read_later (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    news_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (news_id) REFERENCES news_items(id),
    UNIQUE(user_id, news_id)
);

CREATE TABLE IF NOT EXISTS user_alert_keywords (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    keyword TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, keyword)
);

CREATE INDEX IF NOT EXISTS idx_user_read_later_user ON user_read_later(user_id);
CREATE INDEX IF NOT EXISTS idx_user_alert_keywords_user ON user_alert_keywords(user_id);

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '6');

CREATE TABLE IF NOT EXISTS news_entities (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    news_id INTEGER NOT NULL,
    entity_type TEXT NOT NULL,  -- 'person', 'organization', 'location', 'number', 'event'
    entity_value TEXT NOT NULL,
    entity_context TEXT,         -- brief context about this entity
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (news_id) REFERENCES news_items(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_news_entities_news ON news_entities(news_id);
CREATE INDEX IF NOT EXISTS idx_news_entities_type ON news_entities(entity_type);
INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '10');

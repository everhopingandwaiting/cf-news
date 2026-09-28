-- 028: 剔除用户表对 news_items 的外键（冷热分库前置）
--
-- 背景：归档驱逐（services/archive.ts evictBatch）会把超过热窗口的 news_items
-- 行从主库 DELETE。user_favorites / user_read_history / user_read_later /
-- news_comments 对 news_id 的默认外键（NO ACTION）会在父行被删时 RESTRICT，
-- 阻断驱逐。用户数据本身绝不删除，因此改为应用层保证引用（路由侧已有
-- main→archive 回落），把这 4 张表原地重建为无 news_id 外键版本。
--
-- 仅保留对 users(user_id) 的外键（users 行永不删除）。
-- SQLite 无法 ALTER DROP CONSTRAINT → 标准表重建；4 张表合计 ≤ 10 行，成本可忽略。
-- 表结构/UNIQUE/索引与 schema.sql 保持一一对应回填。

-- user_favorites
-- 重试安全：清理上次失败可能残留的中间表（迁移文件中途失败可整文件重跑）
DROP TABLE IF EXISTS user_favorites_new;
CREATE TABLE user_favorites_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    news_id INTEGER NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    deleted_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, news_id)
);
INSERT INTO user_favorites_new (id, user_id, news_id, is_deleted, deleted_at, created_at)
    SELECT id, user_id, news_id, is_deleted, deleted_at, created_at FROM user_favorites;
DROP TABLE user_favorites;
ALTER TABLE user_favorites_new RENAME TO user_favorites;
CREATE INDEX idx_user_favorites_user ON user_favorites(user_id);

-- user_read_history
-- 重试安全：清理上次失败可能残留的中间表（迁移文件中途失败可整文件重跑）
DROP TABLE IF EXISTS user_read_history_new;
CREATE TABLE user_read_history_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    news_id INTEGER NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    deleted_at DATETIME,
    read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, news_id)
);
INSERT INTO user_read_history_new (id, user_id, news_id, is_deleted, deleted_at, read_at)
    SELECT id, user_id, news_id, is_deleted, deleted_at, read_at FROM user_read_history;
DROP TABLE user_read_history;
ALTER TABLE user_read_history_new RENAME TO user_read_history;
CREATE INDEX idx_user_read_history_user ON user_read_history(user_id);

-- user_read_later
-- 重试安全：清理上次失败可能残留的中间表（迁移文件中途失败可整文件重跑）
DROP TABLE IF EXISTS user_read_later_new;
CREATE TABLE user_read_later_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    news_id INTEGER NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id),
    UNIQUE(user_id, news_id)
);
INSERT INTO user_read_later_new (id, user_id, news_id, created_at)
    SELECT id, user_id, news_id, created_at FROM user_read_later;
DROP TABLE user_read_later;
ALTER TABLE user_read_later_new RENAME TO user_read_later;
CREATE INDEX idx_user_read_later_user ON user_read_later(user_id);

-- news_comments
-- 重试安全：清理上次失败可能残留的中间表（迁移文件中途失败可整文件重跑）
DROP TABLE IF EXISTS news_comments_new;
CREATE TABLE news_comments_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    news_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    content TEXT NOT NULL,
    is_deleted INTEGER DEFAULT 0,
    deleted_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);
INSERT INTO news_comments_new (id, news_id, user_id, content, is_deleted, deleted_at, created_at)
    SELECT id, news_id, user_id, content, is_deleted, deleted_at, created_at FROM news_comments;
DROP TABLE news_comments;
ALTER TABLE news_comments_new RENAME TO news_comments;
CREATE INDEX idx_news_comments_news ON news_comments(news_id);
CREATE INDEX idx_news_comments_user ON news_comments(user_id);

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '28');

import { sqliteTable, text, integer, uniqueIndex, primaryKey, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const users = sqliteTable('users', {
    id: integer('id').primaryKey(),
    email: text('email').notNull().unique(),
    password_hash: text('password_hash').notNull(),
    username: text('username'),
    role: text('role').default('user'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const newsSources = sqliteTable('news_sources', {
    id: integer('id').primaryKey(),
    name: text('name').notNull(),
    url: text('url'),
    feed_url: text('feed_url').notNull(),
    category: text('category').default('news'),
    language: text('language').default('zh'),
    source_type: text('source_type').default('rss'),
    enabled: integer('enabled').default(1),
    sort_order: integer('sort_order').default(99),
    last_fetched_at: text('last_fetched_at'),
    last_fetched_count: integer('last_fetched_count').default(0),
    error_count: integer('error_count').default(0),
}, (table) => ({
    feedUrlIdx: uniqueIndex('idx_sources_feed_url').on(table.feed_url),
}));

export const newsItems = sqliteTable('news_items', {
    id: integer('id').primaryKey(),
    source_id: integer('source_id').notNull(),
    title: text('title').notNull(),
    url: text('url').notNull().unique(),
    description: text('description'),
    content: text('content'),
    image_url: text('image_url'),
    category: text('category').default('general'),
    published_at: text('published_at'),
    is_deleted: integer('is_deleted').default(0),
    deleted_at: text('deleted_at'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
    ai_search_uploaded: integer('ai_search_uploaded').default(0),
    dedup_hash: text('dedup_hash'),
}, (table) => ({
    sourceIdx: uniqueIndex('idx_news_items_source').on(table.source_id),
    categoryIdx: uniqueIndex('idx_news_items_category').on(table.category),
    publishedIdx: uniqueIndex('idx_news_items_published').on(table.published_at),
    createdIdx: uniqueIndex('idx_news_items_created').on(table.created_at),
    listIdx: uniqueIndex('idx_news_items_list').on(table.is_deleted, table.created_at),
    catCreatedIdx: uniqueIndex('idx_news_items_cat_created').on(table.is_deleted, table.category, table.created_at),
    srcCreatedIdx: uniqueIndex('idx_news_items_src_created').on(table.is_deleted, table.source_id, table.created_at),
}));

export const userFavorites = sqliteTable('user_favorites', {
    id: integer('id').primaryKey(),
    user_id: integer('user_id').notNull(),
    news_id: integer('news_id').notNull(),
    is_deleted: integer('is_deleted').default(0),
    deleted_at: text('deleted_at'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    userIdx: uniqueIndex('idx_user_favorites_user').on(table.user_id),
    unq: uniqueIndex('unq_user_fav').on(table.user_id, table.news_id),
}));

export const userReadHistory = sqliteTable('user_read_history', {
    id: integer('id').primaryKey(),
    user_id: integer('user_id').notNull(),
    news_id: integer('news_id').notNull(),
    is_deleted: integer('is_deleted').default(0),
    deleted_at: text('deleted_at'),
    read_at: text('read_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    userIdx: uniqueIndex('idx_user_read_history_user').on(table.user_id),
    unq: uniqueIndex('unq_user_read').on(table.user_id, table.news_id),
}));

export const userReadLater = sqliteTable('user_read_later', {
    id: integer('id').primaryKey(),
    user_id: integer('user_id').notNull(),
    news_id: integer('news_id').notNull(),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    userIdx: index('idx_user_read_later_user').on(table.user_id),
    unq: uniqueIndex('unq_user_read_later').on(table.user_id, table.news_id),
}));

export const userAlertKeywords = sqliteTable('user_alert_keywords', {
    id: integer('id').primaryKey(),
    user_id: integer('user_id').notNull(),
    keyword: text('keyword').notNull(),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    userIdx: index('idx_user_alert_keywords_user').on(table.user_id),
    unq: uniqueIndex('unq_user_alert_keyword').on(table.user_id, table.keyword),
}));

export const newsComments = sqliteTable('news_comments', {
    id: integer('id').primaryKey(),
    news_id: integer('news_id').notNull(),
    user_id: integer('user_id').notNull(),
    content: text('content').notNull(),
    is_deleted: integer('is_deleted').default(0),
    deleted_at: text('deleted_at'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    newsIdx: uniqueIndex('idx_news_comments_news').on(table.news_id),
    userIdx: uniqueIndex('idx_news_comments_user').on(table.user_id),
}));

export const newsSummaries = sqliteTable('news_summaries', {
    id: integer('id').primaryKey(),
    news_id: integer('news_id').notNull().unique(),
    summary: text('summary').notNull(),
    illustration_url: text('illustration_url'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const newsAiTake = sqliteTable('news_ai_take', {
    news_id: integer('news_id').primaryKey(),
    take: text('take').notNull(),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const newsEntities = sqliteTable('news_entities', {
    id: integer('id').primaryKey(),
    news_id: integer('news_id').notNull(),
    entity_type: text('entity_type').notNull(),
    entity_value: text('entity_value').notNull(),
    entity_context: text('entity_context'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    newsIdx: index('idx_news_entities_news').on(table.news_id),
    typeIdx: index('idx_news_entities_type').on(table.entity_type),
}));

export const newsPerspectives = sqliteTable('news_perspectives', {
    news_id: integer('news_id').primaryKey(),
    related_ids: text('related_ids').notNull(),
    perspective: text('perspective').notNull(),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const userPreferences = sqliteTable('user_preferences', {
    user_id: integer('user_id').primaryKey(),
    receive_digest: integer('receive_digest').default(0),
    updated_at: text('updated_at').default(sql`CURRENT_TIMESTAMP`),
});

export const aiCallLog = sqliteTable('ai_call_log', {
    id: integer('id').primaryKey(),
    provider: text('provider').notNull(),
    model: text('model'),
    news_id: integer('news_id'),
    news_title: text('news_title'),
    prompt_length: integer('prompt_length'),
    response_length: integer('response_length'),
    response_preview: text('response_preview'),
    duration_ms: integer('duration_ms'),
    success: integer('success').default(1),
    error: text('error'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    newsIdx: index('idx_ai_call_news').on(table.news_id),
}));

export const providers = sqliteTable('providers', {
    name: text('name').primaryKey(),
    base_url: text('base_url').notNull(),
    api_key_env: text('api_key_env'),
    priority: integer('priority').default(99),
    enabled: integer('enabled').default(1),
    expires_at: text('expires_at'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const providerModels = sqliteTable('provider_models', {
    provider: text('provider').notNull(),
    model_id: text('model_id').notNull(),
    score: integer('score').default(50),
    enabled: integer('enabled').default(1),
    type: text('type').default('text'),
    context_size: integer('context_size').default(131072),
    max_output: integer('max_output').default(4096),
}, (table) => ({
    pk: primaryKey({ columns: [table.provider, table.model_id] }),
}));

export const appConfig = sqliteTable('app_config', {
    key: text('key').primaryKey(),
    value: text('value').notNull(),
});

export const dailyDigests = sqliteTable('daily_digests', {
    id: integer('id').primaryKey(),
    date: text('date').notNull().unique(),
    content: text('content').notNull(),
    news_ids: text('news_ids'),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
});

export const pushSubscriptions = sqliteTable('push_subscriptions', {
    id: integer('id').primaryKey(),
    user_id: integer('user_id').notNull(),
    endpoint: text('endpoint').notNull(),
    p256dh_key: text('p256dh_key').notNull(),
    auth_key: text('auth_key').notNull(),
    created_at: text('created_at').default(sql`CURRENT_TIMESTAMP`),
}, (table) => ({
    unq: uniqueIndex('unq_push_sub').on(table.user_id, table.endpoint),
}));

export const trendingTopics = sqliteTable('trending_topics', {
    id: integer('id').primaryKey(),
    keyword: text('keyword').notNull(),
    date_hour: text('date_hour').notNull(),
    count: integer('count').default(1),
}, (table) => ({
    unq: uniqueIndex('unq_trending').on(table.keyword, table.date_hour),
    hourIdx: uniqueIndex('idx_trending_topics_hour').on(table.date_hour),
    kwIdx: uniqueIndex('idx_trending_topics_keyword').on(table.keyword),
}));

export const stopWords = sqliteTable('stop_words', {
    word: text('word').primaryKey(),
    source: text('source').notNull().default('unknown'),
});

export const neuronUsage = sqliteTable('neuron_usage', {
    date: text('date').primaryKey(),
    count: integer('count').default(0),
});

export const newsFts = sqliteTable('news_fts', {
    title: text('title'),
    description: text('description'),
});

export const cronHeartbeat = sqliteTable('cron_heartbeat', {
    cron_name: text('cron_name').primaryKey(),
    last_fired_at: text('last_fired_at').notNull(),
});

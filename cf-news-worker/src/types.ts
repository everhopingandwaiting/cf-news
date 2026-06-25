export interface Bindings {
    DB: D1Database;
    KV: KVNamespace;
    AI: any;
    VECTORIZE: VectorizeIndex;
    CLIPBOARD: DurableObjectNamespace;
    COMMENTS: DurableObjectNamespace;
    PIPING: DurableObjectNamespace;
    EMAIL: SendEmail;
    JWT_SECRET: string;
    NEWS_FETCH_INTERVAL: string;
    OPENROUTER_API_KEY: string;
    NVIDIA_API_KEY: string;
    MANGO_API_KEY: string;
    BROWSER: Fetcher;
    NEWS_QUEUE: Queue<NewsQueueMessage>;
    GLOBAL_RATE_LIMITER: RateLimit;
    AI_SEARCH?: Fetcher;
    TURNSTILE_SECRET: string;
    TURNSTILE_SITE_KEY: string;
}

export interface NewsQueueMessage {
    type: 'fetch_source' | 'generate_summary' | 'index_news';
    sourceId?: number;
    skipSummary?: boolean;
    newsId?: number;
    title?: string;
    description?: string;
    content?: string;
    url?: string;
}

export interface User {
    id: number;
    email: string;
    password_hash: string;
    username?: string;
    role: string;
    created_at: string;
    updated_at: string;
}

export interface JWTPayload {
    sub: number;
    email: string;
    role: string;
    exp: number;
}

export interface NewsSource {
    id: number;
    name: string;
    url: string;
    feed_url: string;
    category: string;
    language: string;
    source_type: string;
    enabled: number;
    sort_order?: number;
    last_fetched_at?: string;
    created_at: string;
}

export interface NewsItem {
    id: number;
    source_id: number;
    title: string;
    url: string;
    description?: string;
    content?: string;
    image_url?: string;
    category: string;
    published_at?: string;
    created_at: string;
    source_name?: string;
}

export interface UserFavorite {
    id: number;
    user_id: number;
    news_id: number;
    created_at: string;
}

export interface UserReadHistory {
    id: number;
    user_id: number;
    news_id: number;
    read_at: string;
}

export interface JWTPayload {
    sub: number;
    email: string;
    exp: number;
}

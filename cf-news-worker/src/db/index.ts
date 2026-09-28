import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type DbClient = DrizzleD1Database<typeof schema>;

// Per-DB-instance cache (not a singleton): fire-and-forget background tasks in
// summarizer re-call getDb() after tests reset the cache — keying by env.DB keeps
// each MockD1 isolated and prevents stale re-population. Production behavior is
// unchanged (one stable DB binding per isolate).
let _clients = new WeakMap<object, DbClient>();

export function getDb(env: { DB: D1Database }): DbClient {
    let db = _clients.get(env.DB);
    if (!db) {
        db = drizzle(env.DB, { schema });
        _clients.set(env.DB, db);
    }
    return db;
}

/**
 * 冷热分库归档库访问器（archive DB 只含 news 内容域表：news_items/fts/summaries/
 * ai_take/entities/perspectives/sources/app_config）。缺失绑定返回 null —— 调用方
 * 必须按"仅主库"降级（P1 基建：行为与单库时代完全一致）。
 */
export function getArchiveDb(env: { DB_ARCHIVE?: D1Database }): DbClient | null {
    if (!env.DB_ARCHIVE) return null;
    let db = _clients.get(env.DB_ARCHIVE);
    if (!db) {
        db = drizzle(env.DB_ARCHIVE, { schema });
        _clients.set(env.DB_ARCHIVE, db);
    }
    return db;
}

/** Reset cached DB clients — used in tests to isolate MockD1 instances */
export function resetDb(): void {
    _clients = new WeakMap();
}

export { schema };

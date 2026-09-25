import { sql } from 'drizzle-orm';
import type { DbClient } from '../db';

/**
 * Minimal KV-style cache backed by the D1 `kv_cache` table.
 * Used to cap expensive full-table computations (COUNTs, trending aggregations)
 * to at most one run per TTL window per key.
 *
 * Uses Drizzle `sql` templates (db.get / db.run), matching the codebase style.
 */

export async function getCache(db: DbClient, key: string): Promise<string | null> {
    const row = await db.get<{ value: string }>(
        sql`SELECT value FROM kv_cache WHERE cache_key = ${key} AND expires_at > ${Math.floor(Date.now() / 1000)}`
    );
    return row ? row.value : null;
}

export async function setCache(db: DbClient, key: string, value: string, ttlSeconds: number): Promise<void> {
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    await db.run(
        sql`INSERT INTO kv_cache (cache_key, value, expires_at) VALUES (${key}, ${value}, ${expires})
            ON CONFLICT(cache_key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at`
    );
}

export async function remember<T>(db: DbClient, key: string, ttlSeconds: number, compute: () => Promise<T>): Promise<T> {
    const cached = await getCache(db, key);
    if (cached !== null) {
        try {
            return JSON.parse(cached) as T;
        } catch {
            // fall through and recompute on parse failure
        }
    }
    const value = await compute();
    await setCache(db, key, JSON.stringify(value), ttlSeconds);
    return value;
}

/** 新闻总数计数器：默认新闻列表 total 的缓存键（TTL 过期后由路由侧重算真实 COUNT） */
export const NEWS_ACTIVE_COUNT_KEY = 'news_items_active_count';
/** 计数器 TTL：1 小时——由 saveNewsItems 增量维护 + TTL 到期重算，避免长窗口内总数失真 */
export const NEWS_ACTIVE_COUNT_TTL = 3600;

/** 过滤列表 COUNT 记忆化 TTL：10 分钟——category/source/lang/has_summary 组合键空间有界，
 *  同一组合 10 分钟内全局（跨 colo）只全表 COUNT 一次；total 允许 ≤10 分钟滞后 */
export const NEWS_FILTERED_COUNT_TTL = 600;
/** 分类聚合缓存键：categories/list 的 GROUP BY 结果（固定键，跨 colo 全局去重） */
export const NEWS_CATEGORIES_KEY = 'news_categories_list';
/** 分类聚合缓存 TTL：10 分钟——分类计数允许 ≤10 分钟滞后 */
export const NEWS_CATEGORIES_TTL = 600;

/**
 * 原子递增缓存值（仅整数语义）。
 * 首次插入时 expires_at=0（视为已过期，getCache/remember 会重算真实值）；
 * 命中已有行时只加值、不动 expires_at，保留原 TTL 的自愈窗口。
 */
export async function incrementCache(db: DbClient, key: string, amount = 1): Promise<void> {
    if (amount <= 0) return;
    await db.run(
        sql`INSERT INTO kv_cache (cache_key, value, expires_at) VALUES (${key}, CAST(${String(amount)} AS TEXT), 0)
            ON CONFLICT(cache_key) DO UPDATE SET value = CAST(MAX(0, CAST(value AS INTEGER) + ${amount}) AS TEXT)`
    );
}

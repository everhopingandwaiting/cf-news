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
    // 同进程内存层：① 常态省掉一次 kv_cache 往返；② D1 写配额耗尽(kv 写不进)时
    // 兜底——否则缓存永远冷、每个请求都全表 COUNT，把 5M/日读配额几小时内打爆
    //（2026-09-26 双配额耗尽事故的读侧放大器）。只在本地 compute 后写入（值必然新鲜，
    // 滞后 ≤ TTL，与 kv_cache 语义一致）；kv 命中路径不回填内存（避免叠加剩余 TTL）。
    const now = Date.now();
    const hit = memCache.get(key);
    if (hit && hit.exp > now) {
        try {
            return JSON.parse(hit.v) as T;
        } catch {
            memCache.delete(key);
        }
    }

    try {
        const cached = await getCache(db, key);
        if (cached !== null) {
            try {
                return JSON.parse(cached) as T;
            } catch {
                // fall through and recompute on parse failure
            }
        }
    } catch (e) {
        // 缓存读失败不阻断：跳到重算（真实数据的读取在 compute 内）
        console.error(`remember: cache read skipped (${key}):`, e);
    }
    const value = await compute();
    const payload = JSON.stringify(value);
    if (memCache.size >= MEM_CACHE_CAP) {
        const oldest = memCache.keys().next();
        if (!oldest.done) memCache.delete(oldest.value);
    }
    memCache.set(key, { v: payload, exp: now + ttlSeconds * 1000 });
    try {
        await setCache(db, key, payload, ttlSeconds);
    } catch (e) {
        // 缓存写失败（D1 日写配额耗尽/存储触顶等平台错误）绝不能把只读端点打成 500：
        // 本次照常返回计算值，内存层承接后续请求，下次到期重算——2026-09-26
        // 免费档写配额被打爆时 /api/news 与 /categories/list 连续 500 的教训。
        console.error(`remember: cache write skipped (${key}):`, e);
    }
    return value;
}

/** 测试/失效场景清空内存层（kv_cache 行级失效无法触达其他 colo 的内存，最长滞后 = TTL） */
export function clearMemCache(): void {
    memCache.clear();
}

/** 新闻总数计数器：默认新闻列表 total 的缓存键（TTL 过期后由路由侧重算真实 COUNT） */
export const NEWS_ACTIVE_COUNT_KEY = 'news_items_active_count';

// 进程内缓存（Map 按插入序淘汰，封顶防无界增长）：见 remember() 注释
const memCache = new Map<string, { v: string; exp: number }>();
const MEM_CACHE_CAP = 500;
/** 计数器 TTL：1 小时——由 saveNewsItems 增量维护 + TTL 到期重算，避免长窗口内总数失真 */
export const NEWS_ACTIVE_COUNT_TTL = 3600;

/** 过滤列表 COUNT 记忆化 TTL：10 分钟——category/source/lang/has_summary 组合键空间有界，
 *  同一组合 10 分钟内全局（跨 colo）只全表 COUNT 一次；total 允许 ≤10 分钟滞后 */
export const NEWS_FILTERED_COUNT_TTL = 600;
/** 分类聚合缓存键：categories/list 的 GROUP BY 结果（固定键，跨 colo 全局去重） */
export const NEWS_CATEGORIES_KEY = 'news_categories_list';
/** 分类聚合缓存 TTL：10 分钟——分类计数允许 ≤10 分钟滞后 */
export const NEWS_CATEGORIES_TTL = 600;
/** 冷热分库归档侧新闻计数键（NEWS_ACTIVE_COUNT_KEY 只计主库热行，两者求和 = 全量） */
export const NEWS_ARCHIVE_COUNT_KEY = 'news_archive_count';

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

import { Bindings } from '../types';
import { getDb, getArchiveDb, type DbClient } from '../db';
import { sql, eq } from 'drizzle-orm';
import { newsItems, newsSources, newsSummaries, newsAiTake, newsEntities, newsPerspectives } from '../db/schema';
import { getConfig, getConfigInt } from './aiProvider';
import { getCache, setCache } from './cache';

/**
 * 冷热归档分库（方案 C）核心服务。
 *
 * 主库 news-db 只保留热窗口内的 news 内容域；超过热窗口的行由 evictBatch 迁往
 * 归档库 cf-news-archive（news_items/fts/summaries/ai_take/entities/perspectives
 * 成组随迁，原始 id 不变 → favorites/comments/digests 的 news_id 引用永久有效）。
 *
 * 读侧约定（跨库无 JOIN/ATTACH，D1 实测 ATTACH 被 SQLITE_AUTH 拒绝）：
 * - 单条解析：resolveNewsSide / dbForNews —— 主库优先，miss 回落归档。
 * - 批量水合：fetchNewsBundle —— 主库先查、缺失补齐（用户列表收藏/历史/稍后读）。
 * - 按页列表：热库恒新于归档库（驱逐按 created_at 从旧到新）→ 主库分片 + 归档
 *   分片按偏移拼接，无需跨库排序合并。
 * - 搜索：searchFtsBoth 双库扇出取 id 并集，交由各库自身 WHERE 过滤。
 * 归档绑定缺失时全部降级为仅主库（P1 阶段行为与单库时代一致）。
 */

export type NewsSide = 'main' | 'archive';

export interface EvictResult {
    moved: number;
    batches: number;
    /** 命中开关/额度/空数据等前置条件，未执行迁移 */
    reason?: string;
    error?: string;
}

// 每批 500 行（与 retention 同参）；单 cron 跑 10 批封顶，防 30s 执行时限
const EVICT_BATCH_SIZE = 500;
const EVICT_MAX_BATCHES = 10;
// app_config 默认值
const DEFAULT_HOT_DAYS = 90;
// 日帽按"账户级 50k rows_written/日"反推：每迁 1 行 ≈ 7 次写（归档侧 copy + 主库删
// 除），生产自身 RSS/摘要/trending/retention 日常 ≈ 15k 写 → 3000 行 × 7 = 21k，
// 合计 ~36k，留 ~14k 余量。2026-09-26 实测：探针实验烧掉当日配额后，缓存写都被拒
// ——宁可回填慢（45k 行 ≈ 15 天），不可把日常写挤爆。
const DEFAULT_EVICT_MAX_ROWS = 3000;

/** 该新闻所在库；两侧都不存在 → null。主库优先（热数据命中率高）。 */
export async function resolveNewsSide(env: Bindings, newsId: number): Promise<NewsSide | null> {
    if (!Number.isFinite(newsId)) return null;
    const main = getDb(env);
    const hit = await main.select({ id: newsItems.id })
        .from(newsItems).where(eq(newsItems.id, newsId)).get();
    if (hit) return 'main';
    const arch = getArchiveDb(env);
    if (!arch) return null;
    const aHit = await arch.select({ id: newsItems.id })
        .from(newsItems).where(eq(newsItems.id, newsId)).get();
    return aHit ? 'archive' : null;
}

/** 解析 newsId 所在库并返回对应 DbClient（side=null 时返回主库，调用方须先判 404）。 */
export async function dbForNews(env: Bindings, newsId: number): Promise<{ db: DbClient; side: NewsSide | null }> {
    const side = await resolveNewsSide(env, newsId);
    if (side === 'archive') {
        const arch = getArchiveDb(env);
        if (arch) return { db: arch, side };
    }
    return { db: getDb(env), side };
}

interface BundleOptions {
    withSummary?: boolean;
    withTake?: boolean;
}

const BUNDLE_IN_CHUNK = 300;

/**
 * 按 id 批量水合新闻（含 source_name + 可选摘要/吐槽）：主库先查、缺失补归档。
 * 收藏 / 阅读历史 / 稍后读等"用户表页 + 新闻详情"两段式查询统一走这里。
 */
export async function fetchNewsBundle(
    env: Bindings,
    ids: number[],
    opts: BundleOptions = {},
): Promise<Map<number, any>> {
    const out = new Map<number, any>();
    const unique = [...new Set(ids.filter(id => Number.isFinite(id)))];
    if (unique.length === 0) return out;

    const withSummary = opts.withSummary !== false;
    const withTake = opts.withTake !== false;

    const querySide = async (db: DbClient, batch: number[]): Promise<void> => {
        for (let i = 0; i < batch.length; i += BUNDLE_IN_CHUNK) {
            const chunk = batch.slice(i, i + BUNDLE_IN_CHUNK);
            const idList = sql.raw(chunk.join(','));
            const rows = await db.all<any>(sql`
                SELECT n.id, n.source_id, n.title, n.url, n.description, n.content, n.image_url,
                       n.category, n.published_at, n.is_deleted, n.created_at,
                       s.name as source_name, s.language as source_lang
                       ${withSummary ? sql`, ns.summary as ai_summary, ns.illustration_url as ai_illustration` : sql``}
                       ${withTake ? sql`, nt.take as ai_take` : sql``}
                FROM news_items n
                LEFT JOIN news_sources s ON n.source_id = s.id
                ${withSummary ? sql`LEFT JOIN news_summaries ns ON ns.news_id = n.id` : sql``}
                ${withTake ? sql`LEFT JOIN news_ai_take nt ON nt.news_id = n.id` : sql``}
                WHERE n.id IN (${idList})
            `);
            for (const row of rows) out.set(row.id, row);
        }
    };

    await querySide(getDb(env), unique);
    const arch = getArchiveDb(env);
    if (arch) {
        const missing = unique.filter(id => !out.has(id));
        if (missing.length > 0) {
            // 归档侧读失败只降级（缺失的冷行不返回）——归档库故障不得拖垮主站列表
            try {
                await querySide(arch, missing);
            } catch (e) {
                console.error('fetchNewsBundle: archive read skipped:', e);
            }
        }
    }
    return out;
}

/**
 * 单条详情（与 news /:id 相同的 raw SQL 形状）：主库 → 归档回落 → null。
 * 独立于 resolveNewsSide：命中热数据时零额外探测（只有真 miss 才查归档）。
 */
export async function fetchNewsDetail(env: Bindings, newsId: number | string): Promise<any | null> {
    const run = async (db: DbClient): Promise<any | null> => {
        const rows = await db.all<any>(sql`
            SELECT n.*, s.name as source_name, s.language as source_lang,
                   ns.summary as ai_summary, ns.illustration_url as ai_illustration, nt.take as ai_take
            FROM news_items n
            LEFT JOIN news_sources s ON n.source_id = s.id
            LEFT JOIN news_summaries ns ON ns.news_id = n.id
            LEFT JOIN news_ai_take nt ON nt.news_id = n.id
            WHERE n.id = ${newsId}
        `);
        return rows[0] || null;
    };
    const mainRow = await run(getDb(env));
    if (mainRow) return mainRow;
    const arch = getArchiveDb(env);
    if (!arch) return null;
    return run(arch);
}

/**
 * 双库 FTS5 命中并集（单侧失败不影响另一侧）。返回的 rowid 交由调用方拼进
 * `n.id IN (...)` —— 各库只取命中的自身行，天然过滤掉对侧 id。
 */
export async function searchFtsBoth(env: Bindings, ftsQuery: string, limit = 200): Promise<number[] | null> {
    const ids: number[] = [];
    const run = async (db: DbClient): Promise<void> => {
        const rows = await db.all<{ rowid: number }>(
            sql`SELECT rowid FROM news_fts WHERE news_fts MATCH ${sql.raw(`'${ftsQuery}'`)} LIMIT ${limit}`
        );
        for (const r of rows) ids.push(r.rowid);
    };
    try {
        await run(getDb(env));
        const arch = getArchiveDb(env);
        if (arch) await run(arch);
    } catch (e) {
        // 单侧（通常是空归档库首次建索引前）出错时，若主库已有结果则照常返回
        console.error('searchFtsBoth error:', e);
        if (ids.length === 0) return null;
    }
    return ids.length > 0 ? ids : null;
}

/**
 * 归档侧是否已有该 URL——跨库 URL 唯一性兜底。主库的 UNIQUE(url) + ON CONFLICT
 * 只保护单侧；改写过标题的老文章（hash/vector 都没抓住）若直接 INSERT 会在主库
 * 再生一份，与归档同 URL 双存 → 抓取入库前用本函数跳过。
 */
export async function existsArchivedUrl(env: Bindings, url: string | undefined | null): Promise<boolean> {
    if (!url) return false;
    const arch = getArchiveDb(env);
    if (!arch) return false;
    const row = await arch.select({ id: newsItems.id })
        .from(newsItems).where(eq(newsItems.url, url)).limit(1).get();
    return !!row;
}

/**
 * 评论数水合：comments 永驻主库，归档行的评论数必须回主库取
 * （归档侧列表 SQL 里 comments_count 恒为 0，合并后由本函数纠正）。
 */
export async function fetchCommentCounts(env: Bindings, ids: number[]): Promise<Map<number, number>> {
    const out = new Map<number, number>();
    const unique = [...new Set(ids.filter(id => Number.isFinite(id)))];
    if (unique.length === 0) return out;
    const main = getDb(env);
    try {
        for (let i = 0; i < unique.length; i += BUNDLE_IN_CHUNK) {
            const chunk = unique.slice(i, i + BUNDLE_IN_CHUNK);
            const idList = sql.raw(chunk.join(','));
            const rows = await main.all<{ news_id: number; c: number }>(sql`
                SELECT news_id, COUNT(*) as c FROM news_comments
                WHERE news_id IN (${idList}) AND is_deleted = 0
                GROUP BY news_id
            `);
            for (const r of rows) out.set(r.news_id, r.c);
        }
    } catch (e) {
        // 评论数是展示型弱数据：读失败留 0，不把整页列表打成 500
        console.error('fetchCommentCounts: skipped:', e);
    }
    return out;
}

/* ─── 驱逐（evict） ─── */

/** 单条 SQL 语句的绑定参数上限 100（D1 limits）—— 按 90 留余量切片。
 *  调用方传入的 cols 是目标表列数；schema 加列后此值偏小只会让分片更细，
 *  不会超限（buffer 反向覆盖），偏大才会撞 100 上限。 */
const MAX_PARAMS_PER_STMT = 90;

function chunkRows<T>(rows: T[], cols: number): T[][] {
    const size = Math.max(1, Math.floor(MAX_PARAMS_PER_STMT / cols));
    const chunks: T[][] = [];
    for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
    return chunks;
}

/** 把主库选中的行批量 INSERT 到归档库（onConflictDoNothing → 崩溃重跑幂等）。 */
async function copyRows(
    main: DbClient,
    arch: DbClient,
    table: any,
    tableName: string,
    cols: number,
    ids: number[],
    whereCol: 'id' | 'news_id',
): Promise<void> {
    // ids 均经 Number.isFinite 校验，raw 拼接安全
    const rows = await main.all<any>(
        sql.raw(`SELECT * FROM ${tableName} WHERE ${whereCol} IN (${ids.join(',')})`)
    );
    if (rows.length === 0) return;
    const stmts = chunkRows(rows, cols)
        .map(chunk => arch.insert(table).values(chunk).onConflictDoNothing());
    for (let i = 0; i < stmts.length; i += 50) {
        await arch.batch(stmts.slice(i, i + 50) as any);
    }
}

/** 同步 news_sources 到归档库（列表 JOIN 依赖；源表仅 ~78 行，全量幂等同步） */
async function syncSources(main: DbClient, arch: DbClient): Promise<void> {
    const rows = await main.select().from(newsSources);
    if (rows.length === 0) return;
    const stmts = chunkRows(rows, 12)
        .map(chunk => (arch.insert(newsSources) as any).values(chunk).onConflictDoNothing());
    for (let i = 0; i < stmts.length; i += 50) {
        await arch.batch(stmts.slice(i, i + 50) as any);
    }
}

/**
 * 冷热归档驱逐：把 created_at 早于热窗口的 news 内容域行从主库搬进归档库。
 *
 * 安全性设计：
 * - 跨库无事务 → 顺序保证不丢数据：归档侧 INSERT（全部 onConflictDoNothing，
 *   幂等）成功后才删主库侧；中途崩溃 → 主库行仍在，下次重跑自愈（最坏=归档
 *   已存在副本被 IGNORE 跳过）。
 * - 显式删子表（不依赖 CASCADE），MockD1/测试环境 foreign_keys 默认关闭也一致。
 * - 驱逐前先同步 news_sources；驱逐后失效 news 计数/分类缓存（expires_at=0），
 *   下次请求重算双库合计。
 * - 额度：app_config `archive.enabled`=1 才执行（默认关闭，部署后手动开启）；
 *   `archive.hot_days`（默认 90）、`archive.evict_max_rows`（默认 4000 行/UTC 日，
 *   每行 ≈7 次 rows_written ≈ 28k，给 RSS 抓取留足 50k/日配额）；
 *   kv_cache `archive:evict:{YYYY-MM-DD}` 记当日已迁量。
 */
export async function evictBatch(env: Bindings): Promise<EvictResult> {
    const main = getDb(env);
    const arch = getArchiveDb(env);
    if (!arch) return { moved: 0, batches: 0, reason: 'no-archive-binding' };

    const enabled = await getConfig(env, 'archive.enabled');
    if (enabled !== '1') return { moved: 0, batches: 0, reason: 'disabled' };

    const hotDays = await getConfigInt(env, 'archive.hot_days', DEFAULT_HOT_DAYS);
    const maxRows = await getConfigInt(env, 'archive.evict_max_rows', DEFAULT_EVICT_MAX_ROWS);
    const utcDay = new Date().toISOString().slice(0, 10);
    const counterKey = `archive:evict:${utcDay}`;
    // 计数器读写全是 best-effort：读失败按 0 起算（cron 每日仅一次，超预算风险可忽略），
    // 写失败不影响已迁数据——配额耗尽等平台错误不得让驱逐半途报错
    let prior = 0;
    try {
        prior = Number(await getCache(main, counterKey)) || 0;
    } catch (e) {
        console.error('evictBatch: counter read skipped:', e);
    }
    if (prior >= maxRows) return { moved: 0, batches: 0, reason: 'daily-cap' };
    let budget = maxRows - prior;

    let moved = 0;
    let batches = 0;
    let sourcesSynced = false;

    try {
        for (let i = 0; i < EVICT_MAX_BATCHES && budget > 0; i++) {
            const take = Math.min(EVICT_BATCH_SIZE, budget);
            const picked = await main.all<{ id: number }>(sql`
                SELECT id FROM news_items
                WHERE created_at < datetime('now', '-' || ${hotDays} || ' days')
                ORDER BY created_at
                LIMIT ${take}
            `);
            const ids = picked.map(r => Number(r.id)).filter(id => Number.isFinite(id));
            if (ids.length === 0) break;
            const idList = sql.raw(ids.join(','));

            if (!sourcesSynced) {
                await syncSources(main, arch);
                sourcesSynced = true;
            }

            // 1) 归档侧写入（顺序关键：先归档全部成功，再删主库）
            await copyRows(main, arch, newsSummaries, 'news_summaries', 5, ids, 'news_id');
            await copyRows(main, arch, newsAiTake, 'news_ai_take', 3, ids, 'news_id');
            await copyRows(main, arch, newsEntities, 'news_entities', 6, ids, 'news_id');
            await copyRows(main, arch, newsPerspectives, 'news_perspectives', 4, ids, 'news_id');
            await copyRows(main, arch, newsItems, 'news_items', 15, ids, 'id');
            // FTS 索引：从归档库刚拷入的 news_items 重建该批 rowid（同库语句）
            await arch.run(sql`
                INSERT OR IGNORE INTO news_fts(rowid, title, description)
                SELECT id, title, description FROM news_items WHERE id IN (${idList})
            `);

            // 2) 主库删除：先子表（不依赖 CASCADE），再 FTS，最后父行
            await main.run(sql`DELETE FROM news_summaries WHERE news_id IN (${idList})`);
            await main.run(sql`DELETE FROM news_ai_take WHERE news_id IN (${idList})`);
            await main.run(sql`DELETE FROM news_entities WHERE news_id IN (${idList})`);
            await main.run(sql`DELETE FROM news_perspectives WHERE news_id IN (${idList})`);
            await main.run(sql`DELETE FROM news_fts WHERE rowid IN (${idList})`);
            await main.run(sql`DELETE FROM news_items WHERE id IN (${idList})`);

            moved += ids.length;
            budget -= ids.length;
            batches++;
        }
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { moved, batches, error: msg };
    }

    if (moved > 0) {
        try {
            await setCache(main, counterKey, String(prior + moved), 48 * 3600);
            // 计数/分类缓存失效 → 下次请求按双库重算（迁移只搬不删总量语义）
            await main.run(sql`
                UPDATE kv_cache SET expires_at = 0
                WHERE cache_key = 'news_items_active_count'
                   OR cache_key = 'news_archive_count'
                   OR cache_key = 'news_categories_list'
                   OR cache_key LIKE 'news_count:%'
            `);
        } catch (e) {
            // 缓存写/失效失败不影响已迁数据（下次 TTL 自愈）
            console.error('evictBatch: cache bookkeeping skipped:', e);
        }
    }
    return { moved, batches };
}

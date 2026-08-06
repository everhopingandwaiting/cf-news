import { Bindings } from '../types';
import { getDb } from '../db';
import { pushSubscriptions, userAlertKeywords } from '../db/schema';
import { sql } from 'drizzle-orm';
import { sendPushNotification } from './webPush';

/**
 * 新闻雷达推送服务：每 15 分钟 cron 检查一次
 *
 * 流程：
 *   1. 查出所有同时拥有「雷达关键词」+「推送订阅」的用户
 *   2. 对每个关键词查最近 6 小时匹配的新闻（SQL 与 routes/user.ts GET /radar 一致）
 *   3. 用 KV 做去重：`radar-push:{userId}:{keyword}` 记录已推送的最大新闻 id，
 *      只推送 id 比它新的新闻；推送完成后更新该值（30 天 TTL 自动清理）
 *   4. 每个用户每次检查最多推送 3 条（防轰炸）
 *
 * 全程 try/catch，绝不抛异常（cron 里调用，异常会浪费重试配额）。
 */

const PUSH_WINDOW_HOURS = 6;            // 只看最近 6 小时的新闻
const MAX_PUSHES_PER_USER = 3;          // 每个用户每次 cron 最多推 3 条
const DEDUP_TTL_SECONDS = 30 * 24 * 3600; // KV 去重记录保留 30 天
const DEDUP_KEY_PREFIX = 'radar-push:';

function dedupKey(userId: number, keyword: string): string {
    return `${DEDUP_KEY_PREFIX}${userId}:${keyword}`;
}

/**
 * 查询某个关键词在最近 N 小时内匹配的新闻 id（按 id 倒序，最多 50 条）。
 * SQL 复刻自 routes/user.ts GET /radar：LIKE 匹配 title 或 description，
 * 转义 LIKE 通配符 % _ \ 防止用户输入被当作通配符。
 */
async function findRecentNewsIds(
    db: ReturnType<typeof getDb>,
    keyword: string
): Promise<number[]> {
    const escaped = keyword.replace(/[%_\\]/g, '\\$&');
    const rows = await db.all<{ id: number }>(sql`
        SELECT n.id
        FROM news_items n
        WHERE n.is_deleted = 0
          AND n.created_at >= datetime('now', '-' || ${PUSH_WINDOW_HOURS} || ' hours')
          AND (n.title LIKE ${'%' + escaped + '%'} ESCAPE '\\' OR n.description LIKE ${'%' + escaped + '%'} ESCAPE '\\')
        ORDER BY n.id DESC
        LIMIT 50
    `);
    return rows.map(r => r.id);
}

interface PushSubscriptionRow {
    endpoint: string;
    p256dh_key: string;
    auth_key: string;
}

/**
 * 主入口：扫描所有用户的雷达关键词，命中新新闻则发送 Web Push。
 * 返回 { sent, failed } 供 cron 日志统计。
 */
export async function checkRadarPush(env: Bindings): Promise<{ sent: number; failed: number }> {
    // KV 是去重的必要条件（也是测试环境的守卫），缺失时直接跳过
    if (!env.KV) {
        console.warn('radarPush: KV not bound, skipping radar push check');
        return { sent: 0, failed: 0 };
    }
    let sent = 0;
    let failed = 0;
    try {
        const db = getDb(env);

        // 1. 查询所有雷达关键词，按用户分组
        const keywordRows = await db.select({
            userId: userAlertKeywords.user_id,
            keyword: userAlertKeywords.keyword,
        }).from(userAlertKeywords).all();
        const keywordsByUser = new Map<number, string[]>();
        for (const row of keywordRows) {
            const list = keywordsByUser.get(row.userId) ?? [];
            list.push(row.keyword);
            keywordsByUser.set(row.userId, list);
        }

        // 2. 查询所有推送订阅，按用户分组
        const subRows = await db.select({
            userId: pushSubscriptions.user_id,
            endpoint: pushSubscriptions.endpoint,
            p256dh_key: pushSubscriptions.p256dh_key,
            auth_key: pushSubscriptions.auth_key,
        }).from(pushSubscriptions).all();
        const subsByUser = new Map<number, PushSubscriptionRow[]>();
        for (const row of subRows) {
            const list = subsByUser.get(row.userId) ?? [];
            list.push({ endpoint: row.endpoint, p256dh_key: row.p256dh_key, auth_key: row.auth_key });
            subsByUser.set(row.userId, list);
        }

        // 3. 只处理「有关键词且有订阅」的用户
        for (const [userId, subscriptions] of subsByUser) {
            const keywords = keywordsByUser.get(userId);
            if (!keywords || keywords.length === 0) continue;

            let pushesForUser = 0; // 本用户本轮已推送条数（全局限额）
            for (const keyword of keywords) {
                if (pushesForUser >= MAX_PUSHES_PER_USER) break;

                try {
                    // 3a. 读取去重水位：已推送的最大新闻 id
                    const stored = await env.KV.get(dedupKey(userId, keyword)).catch(() => null);
                    const storedMax = stored ? parseInt(stored, 10) : null;

                    // 3b. 查最近 6h 命中新闻，过滤掉已推送过的
                    const recentIds = await findRecentNewsIds(db, keyword);
                    const newIds = storedMax === null
                        ? recentIds
                        : recentIds.filter(id => id > storedMax);
                    if (newIds.length === 0) continue;

                    // 3c. 受每人 3 条限额约束，只推最新的一部分
                    const remaining = MAX_PUSHES_PER_USER - pushesForUser;
                    const toPush = newIds.slice(0, remaining);
                    if (toPush.length === 0) break;

                    for (const sub of subscriptions) {
                        if (pushesForUser >= MAX_PUSHES_PER_USER) break;
                        const ok = await sendPushNotification(env, sub, {
                            title: `雷达命中：${keyword}`,
                            body: `新增 ${newIds.length} 条相关新闻`,
                            url: `/api/news?search=${encodeURIComponent(keyword)}`,
                        });
                        if (ok) sent++;
                        else failed++;
                        pushesForUser++;
                    }

                    // 3d. 更新去重水位为「实际已推送」的最大新闻 id（含失败也记录，
                    //     避免同一个死订阅每 15 分钟重试轰炸）；30 天 TTL 自动过期
                    await env.KV.put(
                        dedupKey(userId, keyword),
                        String(Math.max(...toPush)),
                        { expirationTtl: DEDUP_TTL_SECONDS }
                    ).catch(e => console.error('radarPush: KV put failed:', e));
                } catch (e) {
                    // 单个关键词失败不影响其他关键词 / 其他用户
                    console.error(`radarPush: keyword "${keyword}" for user ${userId} failed:`, e);
                }
            }
        }
        return { sent, failed };
    } catch (e) {
        console.error('radarPush: checkRadarPush error:', e);
        return { sent: 0, failed: 0 };
    }
}

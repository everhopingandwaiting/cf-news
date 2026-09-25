import { Bindings } from '../types';
import { getDb } from '../db';
import { sql } from 'drizzle-orm';

/**
 * 存储保留 cron：
 * - news_items.content >30 天 → NULL（正文最大占库；摘要/列表字段保留）
 * - ai_call_log >7 天 → DELETE（modelRefresher 证据窗口默认 2 天，7 天留足余量）
 * 分批 500 行/次，避免 D1 单语句执行时限；每轮最多 40 批，超出留给下次 cron。
 */
const CONTENT_RETENTION_DAYS = 30;
const AI_LOG_RETENTION_DAYS = 7;
const BATCH_SIZE = 500;
const MAX_BATCHES = 40;

export interface RetentionResult {
    contentCleared: number;
    logsDeleted: number;
    batches: number;
}

export async function runRetention(env: Bindings): Promise<RetentionResult> {
    const db = getDb(env);
    let contentCleared = 0;
    let logsDeleted = 0;
    let batches = 0;

    for (let i = 0; i < MAX_BATCHES; i++) {
        const res = await db.run(sql`
            UPDATE news_items SET content = NULL
            WHERE id IN (
                SELECT id FROM news_items
                WHERE content IS NOT NULL
                  AND created_at < datetime('now', '-' || ${CONTENT_RETENTION_DAYS} || ' days')
                LIMIT ${BATCH_SIZE}
            )
        `);
        const changes = Number(res.meta?.changes ?? 0);
        contentCleared += changes;
        batches++;
        if (changes < BATCH_SIZE) break;
    }

    for (let i = 0; i < MAX_BATCHES; i++) {
        const res = await db.run(sql`
            DELETE FROM ai_call_log
            WHERE id IN (
                SELECT id FROM ai_call_log
                WHERE created_at < datetime('now', '-' || ${AI_LOG_RETENTION_DAYS} || ' days')
                LIMIT ${BATCH_SIZE}
            )
        `);
        const changes = Number(res.meta?.changes ?? 0);
        logsDeleted += changes;
        batches++;
        if (changes < BATCH_SIZE) break;
    }

    return { contentCleared, logsDeleted, batches };
}

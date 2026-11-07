import { Bindings } from '../types';
import { getDb } from '../db';
import { getCache, setCache } from './cache';
import { runRetention, type RetentionResult } from './retention';
import { evictBatch, describeError, type EvictResult } from './archive';

/**
 * 每日维护自愈链：retention（清正文/日志）→ evict（冷热迁移）。
 *
 * 为什么需要它：retention 原本只挂在 08:00 那次 invocation（与 digest/email 同一
 * 调度）。2026-11-04 起该 invocation 的子请求预算被 digest 链吃光——KV 心跳照写、
 * 同一次调用里的 D1 写却全部失败且无痕，`retention:last` 快照连续 3 天停更，
 * 外部的 D1 Capacity Check 因此每日变红。把链路挪到每 5 分钟的 summary cron（与
 * evict 自愈同处）后，每一步都有自己的 invocation 预算，失败下一轮 5 分钟重试。
 *
 * 顺序有依赖：retention 先把 >30d 的 content 置 NULL，evict 再搬行，归档库才不背
 * 正文大字段。当日完成后写 `maintenance:done:{utcDay}` 标记，后续轮次早退。
 * 08:00 那一份保持原样（能跑就是白赚，跑不完由这条链兜底）。
 */

/** 每日维护最早执行时刻（UTC 小时）：等 08:00 链先跑完，避免两份并发搬同一批行 */
export const MAINTENANCE_HOUR_UTC = 9;

export interface MaintenanceResult {
    ran: boolean;
    reason?: string;
    retention?: RetentionResult;
    evict?: EvictResult;
}

export async function runDailyMaintenance(
    env: Bindings,
    opts: { now?: Date; force?: boolean } = {},
): Promise<MaintenanceResult> {
    const now = opts.now ?? new Date();
    if (!opts.force && now.getUTCHours() < MAINTENANCE_HOUR_UTC) {
        return { ran: false, reason: 'not-due-yet' };
    }

    const db = getDb(env);
    const dayKey = `maintenance:done:${now.toISOString().slice(0, 10)}`;
    if (!opts.force) {
        try {
            if (await getCache(db, dayKey)) return { ran: false, reason: 'already-ran' };
        } catch { /* 读失败按未跑处理，retention/evict 均为幂等操作 */ }
    }

    let retention: RetentionResult;
    try {
        retention = await runRetention(env);
    } catch (e) {
        const msg = describeError(e);
        await writeSnapshot(db, 'retention:last', { error: msg });
        // retention 失败则不驱逐：正文未清理，搬进归档库会背大字段
        await writeSnapshot(db, 'archive:evict:last', {
            moved: 0, batches: 0, error: `retention 失败，驱逐未执行: ${msg}`,
        });
        return { ran: false, reason: `retention 失败: ${msg}` };
    }
    await writeSnapshot(db, 'retention:last', { ...retention });

    let evict: EvictResult;
    try {
        evict = await evictBatch(env);
    } catch (e) {
        evict = { moved: 0, batches: 0, error: describeError(e) };
    }

    // 全部走完才落"当日完成"标记：半途被平台掐断时下一轮 5 分钟后重试
    try {
        await setCache(db, dayKey, '1', 3 * 24 * 3600);
    } catch { /* 标记写失败只影响去重，不影响维护结果 */ }

    return { ran: true, retention, evict };
}

/** 快照写入 best-effort：写失败不得影响维护主流程，但 at 停更即告警信号 */
async function writeSnapshot(
    db: ReturnType<typeof getDb>,
    key: string,
    payload: Record<string, unknown>,
): Promise<void> {
    try {
        await setCache(db, key, JSON.stringify({ at: new Date().toISOString(), ...payload }), 7 * 24 * 3600);
    } catch (e) {
        console.error(`maintenance snapshot write failed (${key}):`, e);
    }
}

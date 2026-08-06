import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent, type WorkflowStepConfig } from 'cloudflare:workers';
import { sql } from 'drizzle-orm';
import { Bindings } from '../types';
import { getDb } from '../db';
import { extractEntities } from '../services/entityExtractor';
import { storeDedupHash } from '../services/dedup';

/** 待回填实体的条目行结构（与 admin.ts backfill-entities 查询一致） */
interface EntityBackfillItem {
    id: number;
    title: string;
    description: string | null;
    content: string | null;
}

/** 待回填向量的条目行结构（与 admin.ts backfill-vectors 查询一致） */
interface VectorBackfillItem {
    id: number;
    title: string;
    description: string | null;
}

/**
 * 批次查询的 step 配置：最多 3 次尝试（1 次初始 + 2 次重试），指数退避。
 * 单条处理不配置重试 —— 内部 try/catch 捕获失败后 step 始终成功返回，
 * 因此 Workflows 不会对单条失败做重试（与旧 waitUntil 循环的逐条 try/catch 语义一致）。
 */
const BATCH_STEP_CONFIG: WorkflowStepConfig = {
    retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
    timeout: '2 minutes',
};

/**
 * 后台回填 Workflow：把 admin.ts 里基于 waitUntil 的一次性后台循环
 * 改造成 durable 任务，失败自动重试、可跨请求存活。
 * 通过 admin POST /backfill-vectors /backfill-entities 触发。
 */
export class BackfillWorkflow extends WorkflowEntrypoint<Bindings> {
    async run(event: WorkflowEvent<{ type: 'entities' | 'vectors'; batchSize?: number }>, step: WorkflowStep) {
        const { type, batchSize } = event.payload;
        // 归一化批次大小：默认 50，钳制到 [1, 500]，避免单次 step 返回数据过大
        const size = Math.min(Math.max(batchSize ?? 50, 1), 500);

        if (type === 'entities') {
            await this.backfillEntities(step, size);
        } else {
            await this.backfillVectors(step, size);
        }
    }

    /** 实体回填：游标（已处理的最大 id）升序扫描，直到某个批次返回 0 行 */
    private async backfillEntities(step: WorkflowStep, batchSize: number): Promise<void> {
        const db = getDb(this.env);
        let cursor = 0;
        let processed = 0;

        while (true) {
            // 批次查询是独立 step：瞬态 DB 失败由 Workflows 自动重试（最多 3 次尝试）
            let items: EntityBackfillItem[];
            try {
                items = await step.do(`entities-batch-${cursor}`, BATCH_STEP_CONFIG, async () => {
                    // 与 admin.ts backfill-entities 相同的查询模式：只处理尚无实体且有内容/描述的条目
                    return db.all<EntityBackfillItem>(sql`
                        SELECT n.id, n.title, n.description, n.content
                        FROM news_items n
                        LEFT JOIN news_entities ne ON ne.news_id = n.id
                        WHERE n.is_deleted = 0 AND ne.id IS NULL
                          AND (n.content IS NOT NULL OR n.description IS NOT NULL)
                          AND n.id > ${cursor}
                        ORDER BY n.id ASC
                        LIMIT ${batchSize}
                    `);
                });
            } catch (e) {
                // 批次查询重试耗尽：记录并终止，避免同一游标无限循环
                console.error(`Entity backfill batch query failed at cursor=${cursor}:`, e);
                break;
            }

            if (items.length === 0) break; // 没有更多待处理条目，回填完成

            for (const item of items) {
                // 每条一个独立 step；内部 try/catch 吞掉单条失败，防止坏条目拖垮整批或触发整批重试
                await step.do(`entity-${item.id}`, async () => {
                    try {
                        await extractEntities(this.env, item.id, {
                            title: item.title,
                            description: item.description ?? undefined,
                            content: item.content ?? undefined,
                        });
                        processed++;
                    } catch (e) {
                        console.error(`Entity extraction failed for id=${item.id}:`, e);
                    }
                });
            }
            cursor = items[items.length - 1].id; // 推进游标到本批最大 id
        }
        console.log(`Entity backfill finished: ${processed} processed`);
    }

    /** 向量回填：游标升序扫描全部未删除条目，逐条写入 dedup_hash + Vectorize */
    private async backfillVectors(step: WorkflowStep, batchSize: number): Promise<void> {
        const db = getDb(this.env);
        let cursor = 0;
        let stored = 0;

        while (true) {
            let items: VectorBackfillItem[];
            try {
                items = await step.do(`vectors-batch-${cursor}`, BATCH_STEP_CONFIG, async () => {
                    // 与 admin.ts backfill-vectors 相同的查询模式：全部未删除条目，游标推进
                    return db.all<VectorBackfillItem>(sql`
                        SELECT id, title, description
                        FROM news_items
                        WHERE is_deleted = 0 AND id > ${cursor}
                        ORDER BY id ASC
                        LIMIT ${batchSize}
                    `);
                });
            } catch (e) {
                // 批次查询重试耗尽：记录并终止，避免同一游标无限循环
                console.error(`Vector backfill batch query failed at cursor=${cursor}:`, e);
                break;
            }

            if (items.length === 0) break;

            for (const item of items) {
                await step.do(`vector-${item.id}`, async () => {
                    try {
                        await storeDedupHash(this.env, item.id, item.title, item.description ?? undefined);
                        stored++;
                    } catch (e) {
                        console.error(`Vector store failed for id=${item.id}:`, e);
                    }
                });
            }
            cursor = items[items.length - 1].id;
        }
        console.log(`Vector backfill finished: ${stored} stored`);
    }
}

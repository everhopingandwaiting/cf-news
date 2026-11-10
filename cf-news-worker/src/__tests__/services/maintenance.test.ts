import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { MockD1 } from '../mock-d1';
import { getDb, getArchiveDb, resetDb } from '../../db';
import { runDailyMaintenance, MAINTENANCE_HOUR_UTC } from '../../services/maintenance';
import { buildTestApp, request, MOCK_ENV } from '../helpers';

beforeAll(() => {
  resetDb();
});

function newEnv(): any {
  return { DB: new MockD1() as unknown as D1Database };
}

const OLD_ITEM_DATE = '2020-01-01 00:00:00';

/** 固定 UTC 时刻（避免测试依赖真实时钟） */
const utc = (iso: string) => new Date(iso);

describe('runDailyMaintenance', () => {
  it('does nothing before the 09:00 UTC window', async () => {
    resetDb();
    const env = newEnv();
    const r = await runDailyMaintenance(env, { now: utc('2026-11-07T08:59:00Z') });
    expect(r.ran).toBe(false);
    expect(r.reason).toBe('not-due-yet');
    expect(MAINTENANCE_HOUR_UTC).toBe(9);
  });

  it('runs retention then records retention:last, and skips later the same day', async () => {
    resetDb();
    const env = newEnv();
    const db = getDb(env);
    await db.run(sql`
      INSERT INTO news_items (id, source_id, title, url, category, is_deleted, content, created_at)
      VALUES (1, 1, 'Old with content', 'https://old.example/1', 'tech', 0, 'old body', ${OLD_ITEM_DATE})
    `);

    const first = await runDailyMaintenance(env, { now: utc('2026-11-07T09:00:10Z') });
    expect(first.ran).toBe(true);
    expect(first.retention?.contentCleared).toBe(1);
    // 无归档绑定：evict 降级为 no-archive-binding，不影响 retention 已完成
    expect(first.evict?.reason).toBe('no-archive-binding');

    const rows = await db.all<{ content: string | null }>(sql`SELECT content FROM news_items WHERE id = 1`);
    expect(rows[0].content).toBeNull();

    const snap = await db.all<{ value: string }>(sql`SELECT value FROM kv_cache WHERE cache_key = 'retention:last'`);
    expect(snap).toHaveLength(1);
    const parsed = JSON.parse(snap[0].value);
    expect(parsed.at).toBeTruthy();
    expect(parsed.contentCleared).toBe(1);

    const second = await runDailyMaintenance(env, { now: utc('2026-11-07T09:05:10Z') });
    expect(second.ran).toBe(false);
    expect(second.reason).toBe('already-ran');
  });

  it('force option bypasses the 09:00 window and the same-day marker', async () => {
    resetDb();
    const env = newEnv();
    const early = await runDailyMaintenance(env, { now: utc('2026-11-07T03:00:00Z'), force: true });
    expect(early.ran).toBe(true);
    const again = await runDailyMaintenance(env, { now: utc('2026-11-07T03:05:00Z'), force: true });
    expect(again.ran).toBe(true);
  });

  it('runs again on the next UTC day', async () => {
    resetDb();
    const env = newEnv();
    const first = await runDailyMaintenance(env, { now: utc('2026-11-07T09:00:00Z') });
    expect(first.ran).toBe(true);
    const next = await runDailyMaintenance(env, { now: utc('2026-11-08T09:00:00Z') });
    expect(next.ran).toBe(true);
  });
});

describe('POST /api/admin/maintenance/run', () => {
  it('is admin-only (401 without token)', async () => {
    const { app, db } = buildTestApp();
    const res = await request(app, db, '/api/admin/maintenance/run', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});

describe('archive rolling retention (pruneArchive via maintenance)', () => {
  it('deletes over-window archive rows with children, keeps fresh ones, budget = evict moved', async () => {
    resetDb();
    const env = { ...MOCK_ENV, DB: new MockD1() as unknown as D1Database, DB_ARCHIVE: new MockD1() as unknown as D1Database };
    const d = getDb(env);
    const arch = getArchiveDb(env)!;

    // 主库：3 行 >45 天（供驱逐），1 行新鲜
    await d.run(sql`
      INSERT INTO news_items (id, source_id, title, url, category, is_deleted, created_at)
      VALUES
        (1, 1, 'm1', 'https://m1.example', 'tech', 0, '2026-08-01 00:00:00'),
        (2, 1, 'm2', 'https://m2.example', 'tech', 0, '2026-08-01 00:00:00'),
        (3, 1, 'm3', 'https://m3.example', 'tech', 0, '2026-08-01 00:00:00'),
        (4, 1, 'fresh', 'https://fresh.example', 'tech', 0, ${new Date().toISOString()})
    `);
    // 归档：2 行 >120 天（带子表 + FTS），1 行 100 天（保留）
    await arch.run(sql`
      INSERT INTO news_items (id, source_id, title, url, category, is_deleted, created_at)
      VALUES
        (11, 1, 'a-old1', 'https://a11.example', 'tech', 0, '2026-05-01 00:00:00'),
        (12, 1, 'a-old2', 'https://a12.example', 'tech', 0, '2026-05-02 00:00:00'),
        (13, 1, 'a-keep', 'https://a13.example', 'tech', 0, '2026-08-01 00:00:00')
    `);
    await arch.run(sql`INSERT INTO news_summaries (news_id, summary) VALUES (11, 's11')`);
    await arch.run(sql`INSERT INTO news_fts (rowid, title, description) VALUES (11, 'a-old1', NULL)`);
    await arch.run(sql`INSERT INTO news_fts (rowid, title, description) VALUES (13, 'a-keep', NULL)`);
    // 主库旧行也要能被驱逐选中：archive.enabled 需要 app_config
    await d.run(sql`INSERT OR REPLACE INTO app_config (key, value) VALUES ('archive.enabled', '1')`);

    const r = await runDailyMaintenance(env as any, { now: utc('2026-11-10T10:00:00Z') });
    expect(r.ran).toBe(true);
    expect(r.evict?.moved).toBe(3);
    // 清理预算 = 驱逐迁入 3 行 → 只删 3 行里最老的（11、12 都 <120 天，13 保留）
    expect(r.prune?.pruned).toBe(2);

    // 归档剩余 = 超窗的 11/12 被清 + 驱逐拷入的 1/2/3（刚迁入，<120 天）+ 保留的 13
    const archIds = await arch.all(sql`SELECT id FROM news_items ORDER BY id`);
    expect(archIds.map((x: any) => Number(x.id))).toEqual([1, 2, 3, 13]);
    const orphanSummaries = await arch.all(sql`SELECT * FROM news_summaries`);
    expect(orphanSummaries).toHaveLength(0);
    const fts = await arch.all(sql`SELECT rowid FROM news_fts ORDER BY rowid`);
    expect(fts.map((x: any) => Number(x.rowid))).toEqual([1, 2, 3, 13]);
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { MockD1 } from '../mock-d1';
import { getDb, resetDb } from '../../db';
import { runDailyMaintenance, MAINTENANCE_HOUR_UTC } from '../../services/maintenance';
import { buildTestApp, request } from '../helpers';

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

    const rows = await db.all(sql`SELECT content FROM news_items WHERE id = 1`);
    expect(rows[0].content).toBeNull();

    const snap = await db.all(sql`SELECT value FROM kv_cache WHERE cache_key = 'retention:last'`);
    expect(snap).toHaveLength(1);
    const parsed = JSON.parse(snap[0].value as string);
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

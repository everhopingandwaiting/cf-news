import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, request } from '../helpers';

describe('Health endpoint', () => {
  let app: ReturnType<typeof buildTestApp>['app'];
  let db: ReturnType<typeof buildTestApp>['db'];

  beforeEach(() => {
    const built = buildTestApp();
    app = built.app;
    db = built.db;
  });

  it('GET /api/health returns 200', async () => {
    const { status, body } = await request(app, db, '/api/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });

  it('GET /api/health/feed reports stale news as unhealthy', async () => {
    // 不 seed 任何 news_items → lastNewsAt 为空 → ok=false
    const { status, body } = await request(app, db, '/api/health/feed');
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.lastNewsAt).toBeNull();
    expect(body.problems.some((p: string) => p.includes('news_items stale'))).toBe(true);
  });

  it('GET /api/health/feed reports missing cron heartbeat as unhealthy', async () => {
    await db.seed('news_items', [
      { id: 1, source_id: 1, title: 'Fresh', url: 'https://h/1', category: 'tech', is_deleted: 0, created_at: new Date().toISOString() },
    ]);
    // cron_heartbeat 表无记录 → fetch cron heartbeat 缺失 → ok=false
    const { status, body } = await request(app, db, '/api/health/feed');
    expect(status).toBe(200);
    expect(body.ok).toBe(false);
    expect(body.problems.some((p: string) => p.includes('cron heartbeat stale'))).toBe(true);
  });

  it('GET /api/health/feed reports healthy when news fresh and heartbeat present', async () => {
    await db.seed('news_items', [
      { id: 2, source_id: 1, title: 'Fresh news', url: 'https://h/2', category: 'tech', is_deleted: 0, created_at: new Date().toISOString() },
    ]);
    await db.seed('cron_heartbeat', [
      { cron_name: '0 * * * *', last_fired_at: new Date().toISOString() },
    ]);
    const { status, body } = await request(app, db, '/api/health/feed');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.problems).toEqual([]);
  });
});

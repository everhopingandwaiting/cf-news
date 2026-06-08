import { describe, it, expect, beforeAll, vi } from 'vitest';
import { buildTestApp, request } from '../helpers';
import { resetDb } from '../../db';

let app: ReturnType<typeof buildTestApp>['app'];
let db: ReturnType<typeof buildTestApp>['db'];

beforeAll(async () => {
  resetDb();
  vi.stubGlobal('caches', { default: { match: async () => null, put: async () => {}, delete: async () => {} } });
  const built = buildTestApp();
  app = built.app;
  db = built.db;
});

describe('Admin API', () => {
  it('GET /api/admin/sources - returns sources list', async () => {
    await db.seed('news_sources', [{ id: 1, name: 'Src1', feed_url: 'https://rss', category: 'tech', language: 'en', sort_order: 1, last_fetched_at: '2024-01-01 00:00:00', last_fetched_count: 5 }]);
    const { status, body } = await request(app, db, '/api/admin/sources');
    expect(status).toBe(200);
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0].name).toBe('Src1');
    expect(body.sources[0].feed_url).toBe('https://rss');
    expect(body.sources[0].sort_order).toBe(1);
    expect(typeof body.sources[0].last_fetched_at).toBe('string');
    expect(typeof body.sources[0].last_fetched_count).toBe('number');
    expect(typeof body.sources[0].today_count).toBe('number');
  });

  it('GET /api/admin/sources - returns overall stats (today_count + last_count)', async () => {
    await db.seed('news_sources', [
      { id: 10, name: 'OverallSrc1', feed_url: 'https://overall1/rss', category: 'news', language: 'en', sort_order: 1, last_fetched_at: '2024-01-01 00:00:00', last_fetched_count: 10 },
      { id: 11, name: 'OverallSrc2', feed_url: 'https://overall2/rss', category: 'tech', language: 'zh', sort_order: 2, last_fetched_at: '2024-01-01 00:00:00', last_fetched_count: 20 },
    ]);
    const { status, body } = await request(app, db, '/api/admin/sources');
    expect(status).toBe(200);
    expect(typeof body.overall_today_count).toBe('number');
    expect(typeof body.overall_today_last_count).toBe('number');
    expect(body.overall_today_last_count).toBe(35); // 5 (Src1) + 10 + 20
  });

  it('POST /api/admin/sources - creates a source', async () => {
    const { status, body } = await request(app, db, '/api/admin/sources', {
      method: 'POST',
      body: { name: 'NewSrc', feed_url: 'https://new/rss', category: 'news' },
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
  });

  it('POST /api/admin/sources - validates required fields', async () => {
    const { status } = await request(app, db, '/api/admin/sources', {
      method: 'POST',
      body: { name: 'Incomplete' },
    });
    expect(status).toBe(400);
  });

  it('DELETE /api/admin/sources/:id - deletes a source', async () => {
    await db.seed('news_sources', [{ id: 99, name: 'DelSrc', feed_url: 'https://del/rss', category: 'news', language: 'en' }]);
    const { status, body } = await request(app, db, '/api/admin/sources/99', { method: 'DELETE' });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

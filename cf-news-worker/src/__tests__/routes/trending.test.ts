import { describe, it, expect, beforeAll, vi } from 'vitest';
import { buildTestApp, request } from '../helpers';
import { resetDb } from '../../db';

let app: ReturnType<typeof buildTestApp>['app'];
let db: ReturnType<typeof buildTestApp>['db'];

beforeAll(() => {
  resetDb();
  vi.stubGlobal('caches', { default: { match: async () => null, put: async () => {}, delete: async () => {} } });
  const built = buildTestApp();
  app = built.app;
  db = built.db;
});

describe('Trending API', () => {
  it('GET /api/news/trending/topics - returns empty array when no data', async () => {
    const { status, body } = await request(app, db, '/api/news/trending/topics');
    expect(status).toBe(200);
    expect(body.topics).toEqual([]);
  });

  it('GET /api/news/trending/topics - returns topics with data', async () => {
    await db.seed('trending_topics', [
      { keyword: 'AI', date_hour: '2026-06-07 10:00', count: 5 },
      { keyword: 'AI', date_hour: '2026-06-07 11:00', count: 3 },
    ]);
    const { status, body } = await request(app, db, '/api/news/trending/topics');
    expect(status).toBe(200);
    // gte filter now works with MockD1 — data passes the cutoff
    expect(body.topics.length).toBeGreaterThan(0);
    expect(body.topics[0].keyword).toBe('AI');
  });
});

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { buildTestApp, request } from '../helpers';
import { resetDb } from '../../db';

let app: ReturnType<typeof buildTestApp>['app'];
let db: ReturnType<typeof buildTestApp>['db'];
let token: string;

beforeAll(async () => {
  resetDb();
  vi.stubGlobal('caches', { default: { match: async () => null, put: async () => {}, delete: async () => {} } });
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true })));
  const built = buildTestApp();
  app = built.app;
  db = built.db;

  const reg = await request(app, db, '/api/auth/register', {
    method: 'POST',
    body: { email: 'hist@test.com', password: 'pass123', username: 'histuser' },
  });
  token = reg.body.token;

  await db.seed('news_sources', [{ id: 1, name: 'Src', feed_url: 'https://rss', category: 'tech', language: 'en' }]);
  await db.seed('news_items', [
    { id: 1, source_id: 1, title: 'Read Article', url: 'https://read1', category: 'tech', is_deleted: 0 },
  ]);
});

describe('History API', () => {
  it('GET /api/user/history - returns 401 without auth', async () => {
    const { status } = await request(app, db, '/api/user/history');
    expect(status).toBe(401);
  });

  it('POST /api/user/history/1 - marks as read', async () => {
    const { status, body } = await request(app, db, '/api/user/history/1', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(body.message).toBeTruthy();
  });

  it('GET /api/user/history - lists read history', async () => {
    const { status, body } = await request(app, db, '/api/user/history', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(body.history).toHaveLength(1);
    expect(body.history[0].id).toBe(1);
    expect(body.history[0]).toHaveProperty('source_id');
    expect(body.history[0]).toHaveProperty('image_url');
    expect(body.history[0]).toHaveProperty('source_name');
    expect(body.history[0]).toHaveProperty('created_at');
    expect(body.pagination).toBeDefined();
  });

  it('DELETE /api/user/history - clears history', async () => {
    const { status, body } = await request(app, db, '/api/user/history', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(body.message).toBeTruthy();
  });

  it('GET /api/user/history - returns empty after clear', async () => {
    const { status, body } = await request(app, db, '/api/user/history', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(body.history).toHaveLength(0);
  });
});

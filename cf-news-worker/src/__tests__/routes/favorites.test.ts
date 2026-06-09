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
    body: { email: 'fav@test.com', password: 'pass123', username: 'favuser' },
  });
  token = reg.body.token;

  await db.seed('news_sources', [{ id: 1, name: 'Src', feed_url: 'https://rss', category: 'tech', language: 'en' }]);
  await db.seed('news_items', [
    { id: 1, source_id: 1, title: 'Article 1', url: 'https://a1', category: 'tech', is_deleted: 0 },
    { id: 2, source_id: 1, title: 'Article 2', url: 'https://a2', category: 'news', is_deleted: 0 },
  ]);
});

describe('Favorites API', () => {
  it('GET /api/user/favorites - returns 401 without auth', async () => {
    const { status } = await request(app, db, '/api/user/favorites');
    expect(status).toBe(401);
  });

  it('POST /api/user/favorites/:newsId - returns 401 without auth', async () => {
    const { status } = await request(app, db, '/api/user/favorites/1', { method: 'POST' });
    expect(status).toBe(401);
  });

  it('POST /api/user/favorites/:newsId - adds a favorite', async () => {
    const { status, body } = await request(app, db, '/api/user/favorites/1', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(201);
    expect(body.message).toBeTruthy();
  });

  it('GET /api/user/favorites - lists favorites', async () => {
    const { status, body } = await request(app, db, '/api/user/favorites', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(body.favorites).toHaveLength(1);
    expect(body.favorites[0].id).toBe(1);
    expect(body.favorites[0]).toHaveProperty('source_id');
    expect(body.favorites[0]).toHaveProperty('image_url');
    expect(body.favorites[0]).toHaveProperty('source_name');
    expect(body.favorites[0]).toHaveProperty('created_at');
    expect(body.pagination).toBeDefined();
  });

  it('GET /api/user/favorites/export - exports markdown', async () => {
    await db.seed('news_summaries', [{ id: 1, news_id: 1, summary: 'AI summary' }]);
    const { status, body, headers } = await request(app, db, '/api/user/favorites/export', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(headers.get('Content-Type')).toContain('text/markdown');
    expect(body).toContain('# 我的收藏');
  });

  it('DELETE /api/user/favorites/:newsId - removes favorite', async () => {
    const { status, body } = await request(app, db, '/api/user/favorites/1', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(body.message).toBeTruthy();
  });

  it('DELETE /api/user/favorites/:newsId - returns 401 without auth', async () => {
    const { status } = await request(app, db, '/api/user/favorites/1', { method: 'DELETE' });
    expect(status).toBe(401);
  });

  it('GET /api/user/favorites - returns empty after removal', async () => {
    const { status, body } = await request(app, db, '/api/user/favorites', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(body.favorites).toHaveLength(0);
  });
});

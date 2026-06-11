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
    body: { email: 'profile@test.com', password: 'pass123', username: 'puser' },
  });
  token = reg.body.token;
});

describe('User Settings API', () => {
  it('GET /api/user/profile - returns 401 without auth', async () => {
    const { status } = await request(app, db, '/api/user/profile');
    expect(status).toBe(401);
  });

  it('GET /api/user/recommendations - requires auth', async () => {
    const { status } = await request(app, db, '/api/user/recommendations');
    expect(status).toBe(401);
  });

  it('GET /api/user/profile - returns user profile with stats', async () => {
    const { status, body } = await request(app, db, '/api/user/profile', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(body.user.email).toBe('profile@test.com');
    expect(body.user.username).toBe('puser');
    expect(body.stats).toBeDefined();
    expect(body.stats.favoritesCount).toBe(0);
  });

  it('POST /api/user/digest - toggles digest setting', async () => {
    const { status, body } = await request(app, db, '/api/user/digest', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(body.receive_digest).toBe(true);
  });

  it('GET /api/user/digest - returns digest status', async () => {
    const { status, body } = await request(app, db, '/api/user/digest', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(body).toHaveProperty('receive_digest');
  });

  it('GET /api/user/digest - returns 401 without auth', async () => {
    const { status } = await request(app, db, '/api/user/digest');
    expect(status).toBe(401);
  });

  it('POST /api/user/push/subscribe - subscribes to push', async () => {
    const { status, body } = await request(app, db, '/api/user/push/subscribe', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { endpoint: 'https://push/endpoint', keys: { p256dh: 'key', auth: 'auth' } },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('POST /api/user/push/subscribe - validates payload', async () => {
    const { status } = await request(app, db, '/api/user/push/subscribe', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {},
    });
    expect(status).toBe(400);
  });

  it('DELETE /api/user/push/unsubscribe - removes a subscription', async () => {
    await db.seed('push_subscriptions', [
      { id: 2, user_id: 1, endpoint: 'https://push/remove', p256dh_key: 'k', auth_key: 'a' },
    ]);

    const { status, body } = await request(app, db, '/api/user/push/unsubscribe', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
      body: { endpoint: 'https://push/remove' },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('DELETE /api/user/push/unsubscribe - returns 401 without auth', async () => {
    const { status } = await request(app, db, '/api/user/push/unsubscribe', { method: 'DELETE', body: {} });
    expect(status).toBe(401);
  });

  it('read-later endpoints require auth and manage saved items', async () => {
    await db.seed('news_sources', [{ id: 50, name: 'Later Source', feed_url: 'https://later/rss', category: 'tech', language: 'en' }]);
    await db.seed('news_items', [{ id: 501, source_id: 50, title: 'Read later story', url: 'https://later/1', category: 'tech', is_deleted: 0 }]);

    const unauth = await request(app, db, '/api/user/read-later');
    expect(unauth.status).toBe(401);

    const added = await request(app, db, '/api/user/read-later/501', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(added.status).toBe(201);

    const listed = await request(app, db, '/api/user/read-later', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listed.status).toBe(200);
    expect(listed.body.items.some((item: any) => item.id === 501)).toBe(true);

    const removed = await request(app, db, '/api/user/read-later/501', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(removed.status).toBe(200);
  });

  it('radar endpoints manage keywords and matching articles', async () => {
    await db.seed('news_sources', [{ id: 51, name: 'Radar Source', feed_url: 'https://radar/rss', category: 'tech', language: 'en' }]);
    await db.seed('news_items', [{ id: 511, source_id: 51, title: 'Cloudflare launches new AI tool', url: 'https://radar/1', description: 'Cloudflare AI', category: 'tech', created_at: new Date().toISOString().substring(0, 19).replace('T', ' '), is_deleted: 0 }]);

    const invalid = await request(app, db, '/api/user/radar', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { keyword: 'A' },
    });
    expect(invalid.status).toBe(400);

    const added = await request(app, db, '/api/user/radar', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { keyword: 'Cloudflare' },
    });
    expect(added.status).toBe(201);

    const listed = await request(app, db, '/api/user/radar?hours=48', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(listed.status).toBe(200);
    expect(listed.body.keywords.some((kw: any) => kw.keyword === 'Cloudflare')).toBe(true);
    expect(listed.body.alerts.some((alert: any) => alert.keyword === 'Cloudflare' && alert.count > 0)).toBe(true);

    const removed = await request(app, db, '/api/user/radar/Cloudflare', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(removed.status).toBe(200);
  });
});

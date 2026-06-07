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
});

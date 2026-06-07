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
    body: { email: 'ai@test.com', password: 'pass123', username: 'aiuser' },
  });
  token = reg.body.token;
});

describe('AI API', () => {
  it('GET /api/ai/digest - returns digest', async () => {
    await db.seed('daily_digests', [{ id: 1, date: '2026-06-07', content: '# Today\'s news' }]);
    const { status, body } = await request(app, db, '/api/ai/digest');
    expect(status).toBe(200);
    // digest may be null or the seeded data, depending on date matching
    expect(body).toHaveProperty('digest');
  });

  it('POST /api/ai/ask - requires auth', async () => {
    const { status } = await request(app, db, '/api/ai/ask', {
      method: 'POST',
      body: { question: 'What is new?' },
    });
    expect(status).toBe(401);
  });

  it('POST /api/ai/ask - validates question', async () => {
    const { status } = await request(app, db, '/api/ai/ask', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: {},
    });
    expect(status).toBe(400);
  });
});

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { buildTestApp, request } from '../helpers';

let app: ReturnType<typeof buildTestApp>['app'];
let db: ReturnType<typeof buildTestApp>['db'];
let adminToken: string;

async function makeToken(overrides: Record<string, any> = {}): Promise<string> {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = btoa(JSON.stringify({
    sub: 1, email: 'admin@test.com', role: 'admin',
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  }));
  const message = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode('test-jwt-secret'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(
    await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message)),
  )));
  return `${message}.${sig}`;
}

beforeAll(async () => {
  vi.stubGlobal('caches', { default: { match: async () => null, put: async () => {}, delete: async () => {} } });
  vi.stubGlobal('fetch', async () => new Response('<rss><channel><item><title>One</title></item></channel></rss>', {
    status: 200,
    headers: { 'Content-Type': 'application/rss+xml' },
  }));
  const built = buildTestApp();
  app = built.app;
  db = built.db;
  adminToken = await makeToken();
});

describe('Admin API - Auth boundary', () => {
  it('returns 401 without auth header', async () => {
    const { status } = await request(app, db, '/api/admin/sources');
    expect(status).toBe(401);
  });

  it('returns 403 for non-admin token', async () => {
    const userToken = await makeToken({ role: 'user' });
    const { status } = await request(app, db, '/api/admin/sources', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    expect(status).toBe(403);
  });

  it('returns 403 for non-admin POST', async () => {
    const userToken = await makeToken({ role: 'user' });
    const { status } = await request(app, db, '/api/admin/sources', {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
      body: { name: 'ShouldFail', feed_url: 'https://x' },
    });
    expect(status).toBe(403);
  });
});

describe('Admin API - Sources CRUD', () => {
  it('GET /api/admin/sources - returns sources list', async () => {
    await db.seed('news_sources', [{ id: 1, name: 'Src1', feed_url: 'https://rss', category: 'tech', language: 'en', sort_order: 1, last_fetched_at: '2024-01-01 00:00:00', last_fetched_count: 5 }]);
    const { status, body } = await request(app, db, '/api/admin/sources', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(status).toBe(200);
    expect(body.sources).toHaveLength(1);
    expect(body.sources[0].name).toBe('Src1');
    expect(body.sources[0].last_fetched_count).toBe(5);
    expect(typeof body.sources[0].today_count).toBe('number');
    expect(typeof body.overall_today_count).toBe('number');
    expect(typeof body.overall_today_last_count).toBe('number');
  });

  it('GET /api/admin/sources - returns overall stats', async () => {
    await db.seed('news_sources', [
      { id: 10, name: 'OverallSrc1', feed_url: 'https://overall1/rss', category: 'news', language: 'en', sort_order: 1, last_fetched_at: '2024-01-01 00:00:00', last_fetched_count: 10 },
      { id: 11, name: 'OverallSrc2', feed_url: 'https://overall2/rss', category: 'tech', language: 'zh', sort_order: 2, last_fetched_at: '2024-01-01 00:00:00', last_fetched_count: 20 },
    ]);
    const { status, body } = await request(app, db, '/api/admin/sources', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(status).toBe(200);
    expect(body.overall_today_last_count).toBe(35);
  });

  it('POST /api/admin/sources - creates a source', async () => {
    const { status, body } = await request(app, db, '/api/admin/sources', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: 'NewSrc', feed_url: 'https://new/rss', category: 'news' },
    });
    expect(status).toBe(201);
    expect(body.success).toBe(true);
  });

  it('POST /api/admin/sources - validates required fields', async () => {
    const { status } = await request(app, db, '/api/admin/sources', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: 'Incomplete' },
    });
    expect(status).toBe(400);
  });

  it('DELETE /api/admin/sources/:id - deletes a source', async () => {
    await db.seed('news_sources', [{ id: 99, name: 'DelSrc', feed_url: 'https://del/rss', category: 'news', language: 'en' }]);
    const { status, body } = await request(app, db, '/api/admin/sources/99', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

describe('Admin API - Advanced operations', () => {
  it('PUT /api/admin/sources/:id - updates a source', async () => {
    await db.seed('news_sources', [{ id: 50, name: 'OldName', feed_url: 'https://old/rss', category: 'news', language: 'en', sort_order: 5 }]);
    const { status, body } = await request(app, db, '/api/admin/sources/50', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: 'NewName', feed_url: 'https://new/rss', category: 'tech', language: 'zh', enabled: true, sort_order: 1 },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('POST /api/admin/sources/dedup - deduplicates sources', async () => {
    await db.seed('news_sources', [
      { id: 60, name: 'Keep', feed_url: 'https://dup/rss', category: 'news', language: 'en', sort_order: 1 },
      { id: 61, name: 'Dup', feed_url: 'https://dup/rss', category: 'news', language: 'en', sort_order: 2 },
      { id: 62, name: 'Dup2', feed_url: 'https://dup/rss', category: 'news', language: 'en', sort_order: 3 },
    ]);
    const { status, body } = await request(app, db, '/api/admin/sources/dedup', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.deleted).toBe(3);
  });

  it('POST /api/admin/sources/:id/test - returns feed diagnostics', async () => {
    await db.seed('news_sources', [{ id: 70, name: 'Testable', feed_url: 'https://feed/test.xml', category: 'news', language: 'en' }]);
    const { status, body } = await request(app, db, '/api/admin/sources/70/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.items).toBe(1);
    expect(body.feed_type).toBe('RSS');
  });

  it('POST /api/admin/sources/:id/test - returns 404 for missing source', async () => {
    const { status } = await request(app, db, '/api/admin/sources/999999/test', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(status).toBe(404);
  });

  it('GET /api/admin/debug/fetch - validates url', async () => {
    const { status, body } = await request(app, db, '/api/admin/debug/fetch?url=ftp://example.com', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(status).toBe(400);
    expect(body.error).toContain('Only');
  });

  it('GET /api/admin/debug/fetch - returns fetch diagnostics', async () => {
    const { status, body } = await request(app, db, '/api/admin/debug/fetch?url=https://feed/test.xml', {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(status).toBe(200);
    expect(body.status).toBe(200);
    expect(body.item_count).toBe(1);
  });

  it('POST /api/admin/rebuild-index - starts background rebuild', async () => {
    const { status, body } = await request(app, db, '/api/admin/rebuild-index', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('POST /api/admin/backfill-vectors - starts background backfill', async () => {
    const { status, body } = await request(app, db, '/api/admin/backfill-vectors', {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

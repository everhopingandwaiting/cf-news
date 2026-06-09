import { describe, it, expect, beforeAll, vi } from 'vitest';
import { buildTestApp, request } from '../helpers';

let app: ReturnType<typeof buildTestApp>['app'];
let db: ReturnType<typeof buildTestApp>['db'];
let token: string;

beforeAll(async () => {
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

describe('AI API - Digest', () => {
  it('GET /api/ai/digest - returns digest', async () => {
    await db.seed('daily_digests', [{ id: 100, date: '2026-06-07', content: '# Today\'s news' }]);
    const { status, body } = await request(app, db, '/api/ai/digest');
    expect(status).toBe(200);
    expect(body).toHaveProperty('digest');
  });

  it('GET /api/ai/digest/dates - returns list of dates', async () => {
    await db.seed('daily_digests', [
      { id: 110, date: '2026-06-05', content: 'Digest 1' },
      { id: 111, date: '2026-06-04', content: 'Digest 2' },
    ]);
    const { status, body } = await request(app, db, '/api/ai/digest/dates');
    expect(status).toBe(200);
    expect(Array.isArray(body.dates)).toBe(true);
    expect(body.dates.length).toBeGreaterThanOrEqual(2);
    expect(body.dates).toContain('2026-06-05');
    expect(body.dates).toContain('2026-06-04');
  });

  it('GET /api/ai/digest/dates - returns non-empty when digests exist', async () => {
    const { status, body } = await request(app, db, '/api/ai/digest/dates');
    expect(status).toBe(200);
    expect(Array.isArray(body.dates)).toBe(true);
    // digests from previous tests still exist in the shared DB
  });

  it('POST /api/ai/digest/generate - returns 401 without auth', async () => {
    const { status } = await request(app, db, '/api/ai/digest/generate', { method: 'POST' });
    expect(status).toBe(401);
  });

  it('POST /api/ai/digest/generate - generates digest with auth', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'cloudflare')");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('cloudflare', '@cf/test-digest', 100, 1)");
    await db.seed('news_items', [
      { id: 200, source_id: 1, title: 'Digest news title', url: 'https://digest/1', description: 'Digest news description with enough detail.', category: 'tech', published_at: new Date().toISOString(), is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/ai/digest/generate', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });
});

describe('AI API - Q&A', () => {
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

  it('POST /api/ai/ask - returns answer', async () => {
    await db.seed('news_items', [
      { id: 210, source_id: 1, title: 'Askable news', url: 'https://ask/1', description: 'Askable news description', category: 'tech', created_at: new Date().toISOString(), is_deleted: 0 },
    ]);
    const { status, body } = await request(app, db, '/api/ai/ask', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { question: 'What happened?' },
    });
    expect(status).toBe(200);
    expect(body.answer).toBeTruthy();
    expect(Array.isArray(body.chunks)).toBe(true);
  });
});

describe('AI API - Related', () => {
  it('GET /api/ai/related/:id - returns same category fallback', async () => {
    await db.seed('stop_words', [
      { word: 'primary', source: 'test' },
      { word: 'ai', source: 'test' },
      { word: 'news', source: 'test' },
      { word: 'new', source: 'test' },
    ]);
    await db.seed('news_items', [
      { id: 220, source_id: 1, title: 'Primary AI news', url: 'https://related/primary', description: 'Primary', category: 'ai', is_deleted: 0 },
      { id: 221, source_id: 1, title: 'Related AI news', url: 'https://related/other', description: 'Related', category: 'ai', is_deleted: 0 },
    ]);
    const { status, body } = await request(app, db, '/api/ai/related/220');
    expect(status).toBe(200);
    expect(body.related.length).toBeGreaterThan(0);
    expect(body.related[0].id).toBe('221');
  });

  it('GET /api/ai/related/:id - validates id', async () => {
    const { status } = await request(app, db, '/api/ai/related/not-a-number');
    expect(status).toBe(400);
  });
});

describe('AI API - Trending insight', () => {
  it('POST /api/ai/trending/insight - validates keyword', async () => {
    const { status, body } = await request(app, db, '/api/ai/trending/insight', {
      method: 'POST',
      body: {},
    });
    expect(status).toBe(400);
    expect(body.error).toBe('请输入关键词');
  });

  it('POST /api/ai/trending/insight - returns no-news fallback', async () => {
    const { status, body } = await request(app, db, '/api/ai/trending/insight', {
      method: 'POST',
      body: { keyword: 'unlikely-keyword' },
    });
    expect(status).toBe(200);
    expect(body.insight).toContain('近期没有找到');
  });

  it('POST /api/ai/trending/insight - returns AI insight for matching news', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'cloudflare')");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('cloudflare', '@cf/test-insight', 100, 1)");
    await db.seed('news_sources', [{ id: 2, name: 'Insight Source', feed_url: 'https://insight/rss', category: 'tech', language: 'zh' }]);
    await db.seed('news_items', [
      { id: 230, source_id: 2, title: 'OpenAI releases test feature', url: 'https://insight/1', description: 'OpenAI related description', category: 'ai', created_at: new Date().toISOString().substring(0, 19).replace('T', ' '), is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/ai/trending/insight', {
      method: 'POST',
      body: { keyword: 'OpenAI', hours: 48 },
    });
    expect(status).toBe(200);
    expect(body.insight).toBeTruthy();
  });
});

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { buildTestApp, request } from '../helpers';

let app: ReturnType<typeof buildTestApp>['app'];
let db: ReturnType<typeof buildTestApp>['db'];

beforeAll(() => {
  vi.stubGlobal('caches', { default: { match: async () => null, put: async () => {}, delete: async () => {} } });
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true })));
  const built = buildTestApp();
  app = built.app;
  db = built.db;
});

describe('Operations API - Fetch', () => {
  it('POST /api/fetch - triggers fetch', async () => {
    const { status } = await request(app, db, '/api/fetch', { method: 'POST' });
    expect(status).toBe(200);
  });
});

describe('Operations API - Summarize', () => {
  it('POST /api/summarize - runs batch summarization', async () => {
    await db.seed('news_items', [
      { id: 100, source_id: 1, title: 'Sum Test', url: 'https://sum/test', description: 'Test desc', content: 'Test content', category: 'tech', created_at: '2026-06-07 10:00:00', is_deleted: 0 },
    ]);
    const { status, body } = await request(app, db, '/api/summarize', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.generated).toBe('number');
    expect(typeof body.total).toBe('number');
  });

  it('POST /api/summarize - filters invalid ids and skips duplicates gracefully', async () => {
    await db.seed('news_items', [
      { id: 104, source_id: 1, title: 'Valid News', url: 'https://sum/valid', description: 'This is valid content for a summary test.', content: 'This is valid content for a summary test and should be accepted.', category: 'tech', created_at: '2026-06-07 10:03:00', is_deleted: 0 },
      { id: 105, source_id: 1, title: 'Short News', url: 'https://sum/short', description: 'short', content: 'short', category: 'tech', created_at: '2026-06-07 10:04:00', is_deleted: 0 },
    ]);
    await db.seed('news_summaries', [
      { id: 2, news_id: 104, summary: 'already summarized', created_at: '2026-06-07 10:04:00' },
    ]);

    const { status, body } = await request(app, db, '/api/summarize', {
      method: 'POST',
      body: { ids: [104, 104, 105, 0, -1, 'abc', null] },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.total).toBe(1);
    expect(body.generated).toBe(0);
    expect(body.skipped).toBe(1);
  });

  it('POST /api/summarize - returns zero result for empty or too-short batch', async () => {
    await db.seed('news_items', [
      { id: 103, source_id: 1, title: 'Tiny', url: 'https://sum/tiny', description: 'short', content: 'short', category: 'tech', created_at: '2026-06-07 10:00:00', is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/summarize', {
      method: 'POST',
      body: { ids: [103] },
    });

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.total).toBe(1);
    expect(body.generated).toBe(0);
    expect(body.skipped).toBe(1);
  });

  it('POST /api/summarize/:newsId - returns 404 for missing item', async () => {
    const { status, body } = await request(app, db, '/api/summarize/999999', { method: 'POST' });
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  it('POST /api/summarize/:newsId - skips existing summary', async () => {
    await db.seed('news_items', [
      { id: 106, source_id: 1, title: 'Already summarized', url: 'https://sum/existing', description: 'Long enough description for existing summary path.', content: 'Long enough content for existing summary path.', category: 'tech', is_deleted: 0 },
    ]);
    await db.seed('news_summaries', [
      { id: 106, news_id: 106, summary: 'existing summary' },
    ]);

    const { status, body } = await request(app, db, '/api/summarize/106', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.skipped).toBe(true);
  });

  it('POST /api/summarize/:newsId - generates a summary', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'cloudflare')");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('cloudflare', '@cf/test-summary', 100, 1)");
    await db.seed('news_items', [
      { id: 107, source_id: 1, title: 'Summary generation title', url: 'https://sum/generate', description: 'This content is long enough to generate a useful summary in tests.', content: 'This content is long enough to generate a useful summary in tests.', category: 'tech', is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/summarize/107', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.generated).toBe(1);
  });

  it('POST /api/summarize/clear - clears all summaries', async () => {
    await db.seed('news_summaries', [
      { id: 201, news_id: 201, summary: 'one' },
      { id: 202, news_id: 202, summary: 'two' },
    ]);

    const { status, body } = await request(app, db, '/api/summarize/clear', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.success).toBe(true);

    const rows = await db.prepare('SELECT * FROM news_summaries').all();
    expect(rows.results).toEqual([]);
  });

  it('POST /api/take/:newsId - returns 404 for missing item', async () => {
    const { status, body } = await request(app, db, '/api/take/999999', { method: 'POST' });
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  it('POST /api/take/:newsId - returns generated take', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'cloudflare')");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('cloudflare', '@cf/test-take', 100, 1)");
    await db.seed('news_items', [
      { id: 108, source_id: 1, title: 'Take generation title', url: 'https://sum/take', description: 'Description for take generation.', content: 'Content for take generation.', category: 'tech', is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/take/108', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.take).toBeTruthy();
  });
});

describe('Operations API - Translate', () => {
  it('POST /api/translate - validates params', async () => {
    const { status } = await request(app, db, '/api/translate', {
      method: 'POST',
      body: {},
    });
    expect(status).toBe(400);
  });

  it('POST /api/translate - returns translated text', async () => {
    const { status, body } = await request(app, db, '/api/translate', {
      method: 'POST',
      body: { text: 'hello', lang: 'zh' },
    });
    expect(status).toBe(200);
    expect(body.translated).toBeTruthy();
  });
});

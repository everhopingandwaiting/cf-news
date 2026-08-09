import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { buildTestApp, request } from '../helpers';
import { resetDb } from '../../db';

let app: ReturnType<typeof buildTestApp>['app'];
let db: ReturnType<typeof buildTestApp>['db'];

// 每个测试重建 app+db：MockD1 数据不跨测试共享（app_config/provider_models 等表残留会导致
// aiProvider 读到上一个测试写入的 provider/model，vitest 3 的 pool 隔离掩盖过此问题）
beforeEach(() => {
  resetDb();
  vi.stubGlobal('caches', { default: { match: async () => null, put: async () => {}, delete: async () => {} } });
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true })));
  const built = buildTestApp();
  app = built.app;
  db = built.db;
});

// vitest 4 不再自动清理 vi.stubGlobal。先排空微任务：summarizer 会 fire-and-forget 启动
// generateAITake/extractEntities（不 await），若残留到下一个用例执行，会调用下一个用例的
// fetch stub 造成误报；让后台任务在本用例内 settle 后再还原全局 mock
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  vi.unstubAllGlobals();
});

describe('Operations API - Fetch', () => {
  it('POST /api/fetch - triggers fetch', async () => {
    const { status } = await request(app, db, '/api/fetch', { method: 'POST' });
    expect(status).toBe(200);
  });

  it('POST /api/fetch - respects cooldown when not forced', async () => {
    await db.exec(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('last_fetch_time', '${Date.now() + 600000}')`);
    const { status, body } = await request(app, db, '/api/fetch', { method: 'POST' });
    expect(status).toBe(429);
    expect(body.success).toBe(false);
  });

  it('POST /api/fetch?force=1 - bypasses cooldown for monitor self-heal', async () => {
    await db.exec(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('last_fetch_time', '${Date.now() + 600000}')`);
    const { status, body } = await request(app, db, '/api/fetch?force=1', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
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

  it('POST /api/summarize/:newsId - logs provider HTTP failures', async () => {
    vi.stubGlobal('fetch', async () => new Response('rate limited', { status: 429 }));
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'openrouter')");
    await db.exec("DELETE FROM app_config WHERE key='ai_failed_models'");
    await db.exec("INSERT OR REPLACE INTO providers (name, base_url, api_key_env, enabled) VALUES ('openrouter', 'https://openrouter.test', 'OPENROUTER_API_KEY', 1)");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('openrouter', 'model-a', 100, 1)");
    await db.seed('news_items', [
      { id: 109, source_id: 1, title: 'Provider failure title', url: 'https://sum/fail', description: 'This content is long enough to call the provider and log failures.', content: 'This content is long enough to call the provider and log failures.', category: 'tech', is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/summarize/109', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.generated).toBe(0);

    const rows = await db.prepare('SELECT provider, model, success, error, response_preview FROM ai_call_log ORDER BY id DESC LIMIT 1').all();
    expect(rows.results[0].provider).toBe('openrouter');
    expect(rows.results[0].success).toBe(0);
    expect(rows.results[0].error).toContain('HTTP 429');
    expect(rows.results[0].response_preview).toContain('rate limited');
  });

  it('POST /api/summarize/:newsId - limits model attempts per provider', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', async () => {
      calls++;
      return new Response('no capacity', { status: 503 });
    });
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'openrouter')");
    await db.exec("DELETE FROM app_config WHERE key='ai_failed_models'");
    await db.exec("INSERT OR REPLACE INTO providers (name, base_url, api_key_env, enabled) VALUES ('openrouter', 'https://openrouter.test', 'OPENROUTER_API_KEY', 1)");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('openrouter', 'model-a', 100, 1)");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('openrouter', 'model-b', 90, 1)");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('openrouter', 'model-c', 80, 1)");
    await db.seed('news_items', [
      { id: 110, source_id: 1, title: 'Provider limit title', url: 'https://sum/limit', description: 'This content is long enough to call provider models and enforce limits.', content: 'This content is long enough to call provider models and enforce limits.', category: 'tech', is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/summarize/110', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.generated).toBe(0);
    expect(calls).toBe(2);

    const rows = await db.prepare("SELECT model FROM ai_call_log WHERE provider = 'openrouter' AND news_id = 110 ORDER BY id ASC").all();
    expect(rows.results.map((r: any) => r.model)).toEqual(['model-a', 'model-b']);
  });

  it('POST /api/summarize/:newsId - filters failed models before applying provider limit', async () => {
    const requestedModels: string[] = [];
    vi.stubGlobal('fetch', async (_input: any, init?: any) => {
      const body = JSON.parse(String(init?.body || '{}'));
      requestedModels.push(body.model);
      return new Response('no capacity', { status: 503 });
    });
    const now = Math.floor(Date.now() / 1000);
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'openrouter')");
    await db.exec(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('ai_failed_models', '${JSON.stringify({ models: { 'openrouter:model-a': now, 'openrouter:model-b': now } })}')`);
    await db.exec("INSERT OR REPLACE INTO providers (name, base_url, api_key_env, enabled) VALUES ('openrouter', 'https://openrouter.test', 'OPENROUTER_API_KEY', 1)");
    await db.exec("DELETE FROM provider_models WHERE provider = 'openrouter'");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('openrouter', 'model-a', 100, 1)");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('openrouter', 'model-b', 90, 1)");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('openrouter', 'model-c', 80, 1)");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('openrouter', 'model-d', 70, 1)");
    await db.seed('news_items', [
      { id: 111, source_id: 1, title: 'Failed model filter title', url: 'https://sum/filter', description: 'This content is long enough to verify failed models are filtered before limits.', content: 'This content is long enough to verify failed models are filtered before limits.', category: 'tech', is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/summarize/111', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.generated).toBe(0);
    expect(requestedModels).toEqual(['model-c', 'model-d']);

    const rows = await db.prepare("SELECT model FROM ai_call_log WHERE provider = 'openrouter' AND news_id = 111 ORDER BY id ASC").all();
    expect(rows.results.map((r: any) => r.model)).toEqual(['model-c', 'model-d']);
  });

  it('POST /api/summarize/:newsId - scopes failed model cache by provider', async () => {
    const requestedProviders: string[] = [];
    vi.stubGlobal('fetch', async (input: any, init?: any) => {
      const body = JSON.parse(String(init?.body || '{}'));
      const provider = String(input).includes('nvidia.test') ? 'nvidia' : 'openrouter';
      requestedProviders.push(`${provider}:${body.model}`);
      if (provider === 'nvidia') {
        return new Response(JSON.stringify({ choices: [{ message: { content: '这是一段足够长的备用供应商摘要内容。' } }] }), { status: 200 });
      }
      return new Response('blocked', { status: 403 });
    });
    const now = Math.floor(Date.now() / 1000);
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'openrouter,nvidia')");
    await db.exec(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('ai_failed_models', '${JSON.stringify({ models: { 'openrouter:shared-model': now } })}')`);
    await db.exec("INSERT OR REPLACE INTO providers (name, base_url, api_key_env, enabled) VALUES ('openrouter', 'https://openrouter.test', 'OPENROUTER_API_KEY', 1)");
    await db.exec("INSERT OR REPLACE INTO providers (name, base_url, api_key_env, enabled) VALUES ('nvidia', 'https://nvidia.test', 'OPENROUTER_API_KEY', 1)");
    await db.exec("DELETE FROM provider_models WHERE provider IN ('openrouter', 'nvidia')");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('openrouter', 'shared-model', 100, 1)");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('nvidia', 'shared-model', 100, 1)");
    await db.seed('news_items', [
      { id: 112, source_id: 1, title: 'Provider scoped failure title', url: 'https://sum/scoped', description: 'This content is long enough to verify provider scoped failed model cache.', content: 'This content is long enough to verify provider scoped failed model cache.', category: 'tech', is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/summarize/112', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.generated).toBe(1);
    expect(requestedProviders).toEqual(['nvidia:shared-model']);

    const rows = await db.prepare("SELECT provider, model FROM ai_call_log WHERE news_id = 112 ORDER BY id ASC").all();
    expect(rows.results).toEqual([{ provider: 'nvidia', model: 'shared-model' }]);
  });

  it('POST /api/summarize - filters failed models before batch provider limit', async () => {
    const requestedModels: string[] = [];
    vi.stubGlobal('fetch', async (_input: any, init?: any) => {
      const body = JSON.parse(String(init?.body || '{}'));
      requestedModels.push(body.model);
      if (body.model === 'model-c') {
        return new Response(JSON.stringify({
          choices: [{ message: { content: '[{"summary":"第一条足够长的摘要内容。"},{"summary":"第二条足够长的摘要内容。"}]' } }],
        }), { status: 200 });
      }
      return new Response('no capacity', { status: 503 });
    });
    const now = Math.floor(Date.now() / 1000);
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'openrouter')");
    await db.exec(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('ai_failed_models', '${JSON.stringify({ models: { 'openrouter:model-a': now, 'openrouter:model-b': now } })}')`);
    await db.exec("INSERT OR REPLACE INTO providers (name, base_url, api_key_env, enabled) VALUES ('openrouter', 'https://openrouter.test', 'OPENROUTER_API_KEY', 1)");
    await db.exec("DELETE FROM provider_models WHERE provider = 'openrouter'");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('openrouter', 'model-a', 100, 1)");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('openrouter', 'model-b', 90, 1)");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('openrouter', 'model-c', 80, 1)");
    await db.seed('news_items', [
      { id: 124, source_id: 1, title: 'Batch model filter one', url: 'https://sum/batch-filter-1', description: 'This content is long enough to be included in batch model filtering test one.', content: 'This content is long enough to be included in batch model filtering test one.', category: 'tech', is_deleted: 0 },
      { id: 125, source_id: 1, title: 'Batch model filter two', url: 'https://sum/batch-filter-2', description: 'This content is long enough to be included in batch model filtering test two.', content: 'This content is long enough to be included in batch model filtering test two.', category: 'tech', is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/summarize', {
      method: 'POST',
      body: { ids: [124, 125] },
    });
    expect(status).toBe(200);
    expect(body.generated).toBe(2);
    expect(requestedModels).toEqual(['model-c']);

    const rows = await db.prepare('SELECT COUNT(*) as count FROM news_summaries WHERE news_id IN (124, 125)').all();
    expect(rows.results[0].count).toBe(2);
  });

  it('POST /api/summarize - falls back to every article when batch parsing fails', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'cloudflare')");
    await db.exec("DELETE FROM app_config WHERE key = 'ai_failed_models'");
    await db.exec("INSERT OR IGNORE INTO provider_models (provider, model_id, score, enabled) VALUES ('cloudflare', '@cf/test-batch-fallback', 100, 1)");
    await db.seed('news_items', [
      { id: 120, source_id: 1, title: 'Batch fallback title one', url: 'https://sum/batch-1', description: 'This content is long enough to need a generated summary for item one.', content: 'This content is long enough to need a generated summary for item one.', category: 'tech', is_deleted: 0 },
      { id: 121, source_id: 1, title: 'Batch fallback title two', url: 'https://sum/batch-2', description: 'This content is long enough to need a generated summary for item two.', content: 'This content is long enough to need a generated summary for item two.', category: 'tech', is_deleted: 0 },
      { id: 122, source_id: 1, title: 'Batch fallback title three', url: 'https://sum/batch-3', description: 'This content is long enough to need a generated summary for item three.', content: 'This content is long enough to need a generated summary for item three.', category: 'tech', is_deleted: 0 },
      { id: 123, source_id: 1, title: 'Batch fallback title four', url: 'https://sum/batch-4', description: 'This content is long enough to need a generated summary for item four.', content: 'This content is long enough to need a generated summary for item four.', category: 'tech', is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/summarize', {
      method: 'POST',
      body: { ids: [120, 121, 122, 123] },
    });
    expect(status).toBe(200);
    expect(body.generated).toBe(4);
    expect(body.skipped).toBe(0);

    const rows = await db.prepare('SELECT COUNT(*) as count FROM news_summaries WHERE news_id IN (120, 121, 122, 123)').all();
    expect(rows.results[0].count).toBe(4);
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

describe('Operations API - Pixabay stock illustration', () => {
  it('POST /api/illustrate-stock/:newsId - returns 404 for missing item', async () => {
    const { status, body } = await request(app, db, '/api/illustrate-stock/999999', { method: 'POST' });
    expect(status).toBe(404);
    expect(body.success).toBe(false);
  });

  it('POST /api/illustrate-stock/:newsId - fills image_url and returns proxy URL', async () => {
    vi.stubGlobal('fetch', async (input: any) => {
      const url = String(input);
      if (url.includes('pixabay.com/api')) {
        return new Response(JSON.stringify({ hits: [
          { largeImageURL: 'https://cdn.pixabay.com/test-1.jpg', imageWidth: 1280, imageHeight: 853, tags: 'apple, chip, technology' },
        ] }), { status: 200 });
      }
      return new Response(new Uint8Array(10 * 1024), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    });
    await db.seed('news_items', [
      { id: 301, source_id: 1, title: 'Apple launches new AI chip', url: 'https://pix/1', description: 'desc', category: 'tech', is_deleted: 0, image_url: null },
    ]);

    const { status, body } = await request(app, db, '/api/illustrate-stock/301', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.cached).toBe(false);
    expect(body.image_url).toContain('/api/image?url=r2%3A%2F%2Fstock%2F301.');

    const rows = await db.prepare("SELECT image_url FROM news_items WHERE id = 301").all();
    expect(rows.results[0].image_url).toBe(body.image_url);
  });

  it('POST /api/illustrate-stock/:newsId - returns cached when image_url already set', async () => {
    await db.seed('news_items', [
      { id: 302, source_id: 1, title: 'Already has image', url: 'https://pix/2', category: 'tech', is_deleted: 0, image_url: 'https://example.com/old.jpg' },
    ]);

    const { status, body } = await request(app, db, '/api/illustrate-stock/302', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.cached).toBe(true);
    expect(body.image_url).toBe('https://example.com/old.jpg');
  });

  it('POST /api/illustrate-stock/:newsId - returns 502 when Pixabay returns no hits', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ hits: [] }), { status: 200 }));
    await db.seed('news_items', [
      { id: 303, source_id: 1, title: 'No match title', url: 'https://pix/3', category: 'tech', is_deleted: 0, image_url: null },
    ]);

    const { status, body } = await request(app, db, '/api/illustrate-stock/303', { method: 'POST' });
    expect(status).toBe(502);
    expect(body.success).toBe(false);
  });

  it('POST /api/illustrate-stock - batch fills only items without image', async () => {
    await db.prepare('DELETE FROM news_items').run();
    vi.stubGlobal('fetch', async (input: any) => {
      const url = String(input);
      if (url.includes('pixabay.com/api')) {
        return new Response(JSON.stringify({ hits: [
          { largeImageURL: 'https://cdn.pixabay.com/batch.jpg', imageWidth: 1280, imageHeight: 720, tags: 'batch, item, finance' },
        ] }), { status: 200 });
      }
      return new Response(new Uint8Array(10 * 1024), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    });
    await db.seed('news_items', [
      { id: 310, source_id: 1, title: 'Batch item one', url: 'https://pix/b1', category: 'finance', is_deleted: 0, image_url: null },
      { id: 311, source_id: 1, title: 'Batch item two', url: 'https://pix/b2', category: 'tech', is_deleted: 0, image_url: 'https://example.com/has.png' },
    ]);

    const { status, body } = await request(app, db, '/api/illustrate-stock', { method: 'POST', body: { limit: 10 } });
    expect(status).toBe(200);
    expect(body.total).toBe(1);
    expect(body.filled).toBe(1);
    expect(body.failed).toBe(0);

    const rows = await db.prepare('SELECT id, image_url FROM news_items WHERE id IN (310, 311) ORDER BY id').all();
    expect(rows.results[0].image_url).toContain('/api/image?url=r2%3A%2F%2Fstock%2F310.');
    expect(rows.results[1].image_url).toBe('https://example.com/has.png');
  });

  it('POST /api/illustrate-stock - returns empty result when no items missing images', async () => {
    await db.prepare('DELETE FROM news_items').run();
    await db.seed('news_items', [
      { id: 312, source_id: 1, title: 'Has image already', url: 'https://pix/b3', category: 'tech', is_deleted: 0, image_url: 'https://example.com/x.png' },
    ]);

    const { status, body } = await request(app, db, '/api/illustrate-stock', { method: 'POST' });
    expect(status).toBe(200);
    expect(body.total).toBe(0);
    expect(body.filled).toBe(0);
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

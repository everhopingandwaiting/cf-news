import { describe, it, expect, beforeEach, vi } from 'vitest';
import { buildTestApp, request } from '../helpers';
import { resetDb } from '../../db';

let app: ReturnType<typeof buildTestApp>['app'];
let db: ReturnType<typeof buildTestApp>['db'];

function shanghaiDateHour(hoursAgo = 0): string {
  const date = new Date(Date.now() + 8 * 3600 * 1000 - hoursAgo * 3600 * 1000);
  return date.toISOString().substring(0, 13).replace('T', ' ') + ':00:00';
}

function utcDateTime(hoursAgo = 0): string {
  const date = new Date(Date.now() - hoursAgo * 3600 * 1000);
  return date.toISOString().substring(0, 19).replace('T', ' ');
}

beforeEach(() => {
  resetDb();
  vi.stubGlobal('caches', { default: { match: async () => null, put: async () => {}, delete: async () => {} } });
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true })));
  const built = buildTestApp();
  app = built.app;
  db = built.db;
});

describe('Trending API - topics', () => {
  it('GET /api/news/trending/topics - returns empty array when no data', async () => {
    const { status, body } = await request(app, db, '/api/news/trending/topics');
    expect(status).toBe(200);
    expect(body.topics).toEqual([]);
  });

  it('GET /api/news/trending/topics - returns topics with data', async () => {
    await db.seed('trending_topics', [
      { keyword: 'AI', date_hour: shanghaiDateHour(1), count: 5 },
      { keyword: 'AI', date_hour: shanghaiDateHour(2), count: 3 },
    ]);
    const { status, body } = await request(app, db, '/api/news/trending/topics');
    expect(status).toBe(200);
    expect(body.topics.length).toBeGreaterThan(0);
    expect(body.topics[0].keyword).toBe('AI');
  });
});

describe('Trending API - keywords', () => {
  it('GET /api/news/trending - returns empty when no data', async () => {
    const { status, body } = await request(app, db, '/api/news/trending');
    expect(status).toBe(200);
    expect(body.trending).toEqual([]);
  });

  it('GET /api/news/trending - returns trending keywords with metadata', async () => {
    await db.seed('trending_topics', [
      { keyword: 'GPT5', date_hour: shanghaiDateHour(3), count: 10 },
      { keyword: 'GPT5', date_hour: shanghaiDateHour(2), count: 8 },
      { keyword: 'GPT5', date_hour: shanghaiDateHour(1), count: 12 },
    ]);
    const { status, body } = await request(app, db, '/api/news/trending?hours=48');
    expect(status).toBe(200);
    expect(body.trending.length).toBeGreaterThan(0);
    const entry = body.trending.find((t: any) => t.word === 'GPT5');
    expect(entry).toBeDefined();
    expect(typeof entry.count).toBe('number');
    expect(typeof entry.burst).toBe('boolean');
    expect(typeof entry.is_new).toBe('boolean');
    expect(typeof entry.change_pct).toBe('number');
    expect(Array.isArray(entry.sources)).toBe(true);
    expect(Array.isArray(body.dropped)).toBe(true);
  });
});

describe('Trending API - themes', () => {
  it('GET /api/news/trending/themes - returns empty when no data', async () => {
    const { status, body } = await request(app, db, '/api/news/trending/themes');
    expect(status).toBe(200);
    expect(body.themes).toEqual([]);
  });

  it('GET /api/news/trending/themes - returns theme clusters with articles', async () => {
    await db.seed('news_sources', [{ id: 1, name: 'TechCrunch', feed_url: 'https://tc/rss', category: 'tech', language: 'en' }]);
    await db.seed('trending_topics', [
      { keyword: 'AI', date_hour: shanghaiDateHour(4), count: 2 },
      { keyword: 'AI', date_hour: shanghaiDateHour(1), count: 8 },
      { keyword: 'AI_model', date_hour: shanghaiDateHour(1), count: 4 },
    ]);
    await db.seed('news_items', [
      { id: 20, source_id: 1, title: 'AI model launches today', url: 'https://ai', description: 'AI model news', category: 'tech', created_at: utcDateTime(1), is_deleted: 0 },
    ]);
    const { status, body } = await request(app, db, '/api/news/trending/themes?hours=48');
    expect(status).toBe(200);
    expect(body.themes.length).toBeGreaterThan(0);
    expect(body.themes[0]).toHaveProperty('label');
    expect(body.themes[0]).toHaveProperty('status');
    expect(Array.isArray(body.themes[0].keywords)).toBe(true);
    expect(Array.isArray(body.themes[0].articles)).toBe(true);
  });

  it('GET /api/news/trending/themes - falls back to default hours for invalid input', async () => {
    await db.seed('trending_topics', [
      { keyword: 'Cloudflare', date_hour: shanghaiDateHour(1), count: 5 },
    ]);
    const { status, body } = await request(app, db, '/api/news/trending/themes?hours=bad');
    expect(status).toBe(200);
    expect(body.themes.length).toBe(1);
    expect(body.themes[0].label).toBe('Cloudflare');
  });
});

describe('Trending API - categories', () => {
  it('GET /api/news/trending/categories - returns empty when no data', async () => {
    const { status, body } = await request(app, db, '/api/news/trending/categories');
    expect(status).toBe(200);
    expect(body.categories).toEqual([]);
    expect(body.total).toBe(0);
  });

  it('GET /api/news/trending/categories - returns category distribution', async () => {
    await db.seed('trending_topics', [
      { keyword: 'LLM', date_hour: shanghaiDateHour(1), count: 5 },
    ]);
    await db.seed('news_items', [
      { id: 10, source_id: 1, title: 'LLM News', url: 'https://a', category: 'tech', created_at: utcDateTime(1), is_deleted: 0 },
      { id: 11, source_id: 1, title: 'LLM More', url: 'https://b', category: 'tech', created_at: utcDateTime(2), is_deleted: 0 },
    ]);
    const { status, body } = await request(app, db, '/api/news/trending/categories?hours=48');
    expect(status).toBe(200);
    expect(body.categories.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThan(0);
    expect(body.categories[0]).toHaveProperty('name');
    expect(body.categories[0]).toHaveProperty('count');
    expect(body.categories[0]).toHaveProperty('pct');
  });
});

describe('Trending API - compare', () => {
  it('GET /api/news/trending/compare - validates keywords param', async () => {
    const { status, body } = await request(app, db, '/api/news/trending/compare');
    expect(status).toBe(200);
    expect(body.series).toEqual([]);
  });

  it('GET /api/news/trending/compare - returns series for keywords', async () => {
    await db.seed('trending_topics', [
      { keyword: 'React', date_hour: shanghaiDateHour(1), count: 5 },
      { keyword: 'Vue', date_hour: shanghaiDateHour(1), count: 3 },
    ]);
    const { status, body } = await request(app, db, '/api/news/trending/compare?keywords=React,Vue&hours=48');
    expect(status).toBe(200);
    expect(body.series).toHaveLength(2);
    expect(body.series[0].keyword).toBe('React');
    expect(body.series[0].points.length).toBeGreaterThan(0);
    expect(body.series[1].keyword).toBe('Vue');
  });

  it('GET /api/news/trending/compare - enforces max 10 keywords', async () => {
    const manyKeywords = Array.from({ length: 11 }, (_, i) => `kw${i}`).join(',');
    const { status, body } = await request(app, db, `/api/news/trending/compare?keywords=${manyKeywords}`);
    expect(status).toBe(400);
    expect(body.error).toContain('最多比较');
  });
});

describe('Trending API - hourly', () => {
  it('GET /api/news/trending/hourly - returns source + category distribution', async () => {
    await db.seed('news_sources', [{ id: 1, name: 'TechCrunch', feed_url: 'https://tc/rss', category: 'tech', language: 'en' }]);
    await db.seed('news_items', [
      { id: 1, source_id: 1, title: 'News 1', url: 'https://n1', category: 'tech', created_at: utcDateTime(1), is_deleted: 0 },
      { id: 2, source_id: 1, title: 'News 2', url: 'https://n2', category: 'tech', created_at: utcDateTime(2), is_deleted: 0 },
    ]);
    const { status, body } = await request(app, db, '/api/news/trending/hourly?hours=48');
    expect(status).toBe(200);
    expect(body.sources.length).toBeGreaterThan(0);
    expect(body.categories.length).toBeGreaterThan(0);
    expect(body.sources[0]).toHaveProperty('hour');
    expect(body.sources[0]).toHaveProperty('source_name');
    expect(body.sources[0]).toHaveProperty('count');
  });
});

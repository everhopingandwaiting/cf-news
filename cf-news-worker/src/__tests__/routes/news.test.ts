import { describe, it, expect, beforeAll, vi } from 'vitest';
import { buildTestApp, request } from '../helpers';
import { resetDb } from '../../db';

beforeAll(async () => {
  resetDb();
  vi.stubGlobal('caches', {
    default: {
      match: async () => null,
      put: async () => {},
      delete: async () => {},
    },
  });
});

const { app, db } = buildTestApp();

describe('News API', () => {

  it('GET /api/news/sources/list - returns sources list', async () => {
    await db.seed('news_sources', [
      { id: 1, name: 'TechCrunch', feed_url: 'https://techcrunch.com/rss', category: 'tech', language: 'en', sort_order: 1, last_fetched_at: '2024-01-01 00:00:00', last_fetched_count: 5 },
      { id: 2, name: 'BBC News', feed_url: 'https://bbc.com/rss', category: 'news', language: 'en', sort_order: 2, last_fetched_at: '2024-01-01 00:00:00', last_fetched_count: 3 },
    ]);

    const { status, body } = await request(app, db, '/api/news/sources/list');
    expect(status).toBe(200);
    expect(body.sources.length).toBeGreaterThanOrEqual(2);
    expect(body.sources[0].name).toBe('TechCrunch');
    expect(body.sources[0].feed_url).toBe('https://techcrunch.com/rss');
    expect(body.sources[0].sort_order).toBe(1);
    expect(typeof body.sources[0].last_fetched_at).toBe('string');
    expect(typeof body.sources[0].last_fetched_count).toBe('number');
  });

  it('GET /api/news/categories/list - returns categories with counts', async () => {
    await db.seed('news_items', [
      { id: 1, source_id: 1, title: 'Tech News 1', url: 'https://example.com/1', category: 'tech', is_deleted: 0 },
      { id: 2, source_id: 1, title: 'Tech News 2', url: 'https://example.com/2', category: 'tech', is_deleted: 0 },
      { id: 3, source_id: 2, title: 'World News', url: 'https://example.com/3', category: 'news', is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/news/categories/list');
    expect(status).toBe(200);
    expect(body.categories).toHaveLength(2);
    const techCat = body.categories.find((c: any) => c.category === 'tech');
    expect(techCat.count).toBe(2);
  });

  it('GET /api/news/:id - returns a specific news item', async () => {
    const { status, body } = await request(app, db, '/api/news/1');
    expect(status).toBe(200);
    expect(body.news.id).toBe(1);
    expect(body.news.title).toBe('Tech News 1');
  });

  it('GET /api/news/:id - returns 404 for non-existent item', async () => {
    const { status, body } = await request(app, db, '/api/news/999');
    expect(status).toBe(404);
    expect(body.error).toBeTruthy();
  });

  it('GET /api/news - returns paginated news list', async () => {
    const { status, body } = await request(app, db, '/api/news');
    expect(status).toBe(200);
    expect(body.news).toHaveLength(3);
    expect(body.pagination.page).toBe(1);
    expect(body.pagination.limit).toBe(20);
    expect(body.pagination.total).toBe(3);
  });

  it('GET /api/news - filters by category', async () => {
    const { status, body } = await request(app, db, '/api/news?category=tech');
    expect(status).toBe(200);
    expect(body.news).toHaveLength(2);
    expect(body.news.every((n: any) => n.category === 'tech')).toBe(true);
  });

  it('GET /api/news - paginates correctly', async () => {
    const { status, body } = await request(app, db, '/api/news?page=1&limit=2');
    expect(status).toBe(200);
    expect(body.news).toHaveLength(2);
    expect(body.pagination.total).toBe(3);
    expect(body.pagination.hasMore).toBe(true);
  });

  it('GET /api/news - hasMore false when total <= limit', async () => {
    const { status, body } = await request(app, db, '/api/news?page=1&limit=20');
    expect(status).toBe(200);
    expect(body.news).toHaveLength(3);
    expect(body.pagination.hasMore).toBe(false);
    expect(body.pagination.totalPages).toBe(1);
  });

  it('GET /api/news - LIKE injection % is escaped', async () => {
    const { status, body } = await request(app, db, '/api/news?search=%25');
    expect(status).toBe(200);
    expect(body.news).toHaveLength(0);
    expect(body.pagination.total).toBe(0);
  });

  it('GET /api/news - filters by source, language, and summary state', async () => {
    await db.seed('news_sources', [
      { id: 10, name: 'English Source', feed_url: 'https://en/rss', category: 'tech', language: 'en', sort_order: 10 },
      { id: 11, name: 'Chinese Source', feed_url: 'https://zh/rss', category: 'tech', language: 'zh', sort_order: 11 },
    ]);
    await db.seed('news_items', [
      { id: 20, source_id: 10, title: 'English with summary', url: 'https://filter/en-summary', category: 'tech', is_deleted: 0 },
      { id: 21, source_id: 11, title: 'Chinese without summary', url: 'https://filter/zh-no-summary', category: 'tech', is_deleted: 0 },
    ]);
    await db.seed('news_summaries', [{ id: 20, news_id: 20, summary: 'summary' }]);

    const { status, body } = await request(app, db, '/api/news?source_id=10&lang=en&has_summary=1');
    expect(status).toBe(200);
    expect(body.news.map((item: any) => item.id)).toContain(20);
    expect(body.news.map((item: any) => item.id)).not.toContain(21);
  });

  it('GET /api/news/:id/content - returns cached long content', async () => {
    const longContent = 'x'.repeat(501);
    await db.seed('news_items', [
      { id: 30, source_id: 1, title: 'Long content', url: 'https://content/long', content: longContent, description: 'fallback', category: 'tech', is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/news/30/content');
    expect(status).toBe(200);
    expect(body.content).toBe(longContent);
  });

  it('GET /api/news/:id/content - returns 404 for missing item', async () => {
    const { status } = await request(app, db, '/api/news/999999/content');
    expect(status).toBe(404);
  });

  it('GET /api/news/:id/perspectives - returns 404 when unavailable', async () => {
    const { status, body } = await request(app, db, '/api/news/999999/perspectives');
    expect(status).toBe(404);
    expect(body.error).toBeTruthy();
  });

  it('GET /api/news/timeline - returns ordered events for a keyword', async () => {
    await db.seed('news_sources', [{ id: 30, name: 'Timeline Source', feed_url: 'https://timeline/rss', category: 'news', language: 'en' }]);
    await db.seed('news_items', [
      { id: 101, source_id: 30, title: 'AI regulation first update', url: 'https://timeline/1', description: 'AI regulation in US', category: 'news', published_at: new Date(Date.now() - 2 * 3600000).toISOString(), created_at: new Date().toISOString().substring(0, 19).replace('T', ' '), is_deleted: 0 },
      { id: 102, source_id: 30, title: 'AI regulation latest update', url: 'https://timeline/2', description: 'AI regulation in US', category: 'news', published_at: new Date(Date.now() - 1 * 3600000).toISOString(), created_at: new Date().toISOString().substring(0, 19).replace('T', ' '), is_deleted: 0 },
      { id: 103, source_id: 30, title: 'AI regulation old update', url: 'https://timeline/3', description: 'AI regulation in US', category: 'news', published_at: new Date(Date.now() - 7 * 24 * 3600000).toISOString(), created_at: new Date().toISOString().substring(0, 19).replace('T', ' '), is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/news/timeline?keyword=AI%20regulation&hours=48');
    expect(status).toBe(200);
    expect(body.keyword).toBe('AI regulation');
    expect(body.events.map((event: any) => event.id)).toEqual([102, 101]);
    expect(body.events[0].stage).toBe('latest');
    expect(body.events[1].stage).toBe('first');
  });

  it('GET /api/news/map - groups articles by inferred region', async () => {
    await db.seed('news_sources', [{ id: 31, name: 'Map Source', feed_url: 'https://map/rss', category: 'news', language: 'zh' }]);
    await db.seed('news_items', [
      { id: 111, source_id: 31, title: '北京发布 AI 政策', url: 'https://map/1', description: '中国科技新闻', category: 'tech', created_at: new Date().toISOString().substring(0, 19).replace('T', ' '), is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/news/map?hours=48');
    expect(status).toBe(200);
    expect(body.regions.some((r: any) => r.code === 'CN')).toBe(true);
  });

  it('GET /api/news/fresh-view - excludes requested categories', async () => {
    await db.seed('news_sources', [{ id: 32, name: 'Fresh Source', feed_url: 'https://fresh/rss', category: 'health', language: 'zh' }]);
    await db.seed('news_items', [
      { id: 121, source_id: 32, title: 'Health update', url: 'https://fresh/1', description: 'Health', category: 'health', created_at: new Date().toISOString().substring(0, 19).replace('T', ' '), is_deleted: 0 },
      { id: 122, source_id: 32, title: 'Tech update', url: 'https://fresh/2', description: 'Tech', category: 'tech', created_at: new Date().toISOString().substring(0, 19).replace('T', ' '), is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/news/fresh-view?exclude=tech&limit=5');
    expect(status).toBe(200);
    expect(body.recommendations.length).toBeGreaterThan(0);
    expect(body.recommendations.every((item: any) => item.category !== 'tech')).toBe(true);
  });

  it('GET /api/news/:id/credibility - returns corroboration signals', async () => {
    await db.seed('news_sources', [
      { id: 33, name: 'Cred Source A', feed_url: 'https://cred/a', category: 'news', language: 'en' },
      { id: 34, name: 'Cred Source B', feed_url: 'https://cred/b', category: 'news', language: 'zh' },
    ]);
    await db.seed('news_items', [
      { id: 131, source_id: 33, title: 'NVIDIA announces AI chip', url: 'https://cred/1', description: 'AI chip launch', category: 'tech', created_at: new Date().toISOString().substring(0, 19).replace('T', ' '), is_deleted: 0 },
      { id: 132, source_id: 34, title: 'NVIDIA AI chip released', url: 'https://cred/2', description: 'AI chip related report', category: 'tech', created_at: new Date().toISOString().substring(0, 19).replace('T', ' '), is_deleted: 0 },
    ]);

    const { status, body } = await request(app, db, '/api/news/131/credibility');
    expect(status).toBe(200);
    expect(typeof body.score).toBe('number');
    expect(body.related_count).toBeGreaterThan(0);
    expect(Array.isArray(body.signals)).toBe(true);
  });

});

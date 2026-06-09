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
    expect(body.sources).toHaveLength(2);
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

});

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

});

import { describe, it, expect, vi } from 'vitest';
import { handleNewsQueue } from '../../services/queueConsumer';
import { MockD1 } from '../mock-d1';
import { resetDb, getDb } from '../../db';
import { newsItems } from '../../db/schema';
import { eq } from 'drizzle-orm';

describe('Queue - illustrate_stock', () => {
  it('fills image_url for a news item via queue message', async () => {
    vi.stubGlobal('fetch', async (input: any) => {
      const url = String(input);
      if (url.includes('pixabay.com/api')) {
        return new Response(JSON.stringify({ hits: [{ largeImageURL: 'https://cdn.pixabay.com/q.jpg', imageWidth: 1280, imageHeight: 720, tags: 'apple, chip, technology' }] }), { status: 200 });
      }
      return new Response(new Uint8Array(10 * 1024), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    });

    resetDb();
    const db = new MockD1();
    await db.seed('news_items', [{ id: 1, source_id: 1, title: 'Apple chip news', url: 'https://x/1', category: 'tech', is_deleted: 0, image_url: null }]);
    const env: any = {
      DB: db,
      KV: { get: async () => null, put: async () => {} },
      PIXABAY_API_KEY: 'test-key',
      R2_IMAGES: { put: async () => {} },
    };
    const batch = {
      messages: [{
        body: { type: 'illustrate_stock', newsId: 1, title: 'Apple chip news', category: 'tech' },
        ack: () => {}, retry: () => {},
      }],
    };
    await handleNewsQueue(batch as any, env);
    const rows = await getDb(env).select().from(newsItems).where(eq(newsItems.id, 1)).all();
    expect(rows[0]?.image_url).toContain('/api/image?url=r2%3A%2F%2Fstock%2F1.');
  });

  it('acknowledges message when Pixabay returns no hits', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ hits: [] }), { status: 200 }));
    resetDb();
    const db = new MockD1();
    await db.seed('news_items', [{ id: 2, source_id: 1, title: 'No match', url: 'https://x/2', category: 'tech', is_deleted: 0, image_url: null }]);
    const env: any = { DB: db, KV: { get: async () => null, put: async () => {} }, PIXABAY_API_KEY: 'test-key', R2_IMAGES: { put: async () => {} } };
    let acked = false;
    const batch = {
      messages: [{
        body: { type: 'illustrate_stock', newsId: 2, title: 'No match', category: 'tech' },
        ack: () => { acked = true; }, retry: () => {},
      }],
    };
    await handleNewsQueue(batch as any, env);
    expect(acked).toBe(true);
    const rows = await getDb(env).select().from(newsItems).where(eq(newsItems.id, 2)).all();
    expect(rows[0]?.image_url).toBeNull();
  });

  it('picks different candidate image per newsId from cached list', async () => {
    const cache = new Map<string, string>();
    vi.stubGlobal('fetch', async (input: any) => {
      const url = String(input);
      if (url.includes('pixabay.com/api')) {
        return new Response(JSON.stringify({
          hits: [
            { largeImageURL: 'https://cdn.pixabay.com/a.jpg', imageWidth: 1280, imageHeight: 720, tags: 'same, topic' },
            { largeImageURL: 'https://cdn.pixabay.com/b.jpg', imageWidth: 1000, imageHeight: 563, tags: 'same, topic' },
            { largeImageURL: 'https://cdn.pixabay.com/c.jpg', imageWidth: 800, imageHeight: 450, tags: 'same, topic' },
          ],
        }), { status: 200 });
      }
      return new Response(new Uint8Array(10 * 1024), { status: 200, headers: { 'Content-Type': 'image/jpeg' } });
    });

    resetDb();
    const db = new MockD1();
    await db.seed('news_items', [
      { id: 10, source_id: 1, title: 'Same topic A', url: 'https://x/10', category: 'tech', is_deleted: 0, image_url: null },
      { id: 11, source_id: 1, title: 'Same topic B', url: 'https://x/11', category: 'tech', is_deleted: 0, image_url: null },
      { id: 12, source_id: 1, title: 'Same topic C', url: 'https://x/12', category: 'tech', is_deleted: 0, image_url: null },
    ]);
    const env: any = {
      DB: db,
      KV: {
        get: async (k: string) => cache.get(k) ?? null,
        put: async (k: string, v: string) => { cache.set(k, v); },
      },
      PIXABAY_API_KEY: 'test-key',
      R2_IMAGES: { put: async () => {} },
    };
    const ack = () => {};
    const mk = (id: number, title: string) => ({ messages: [{ body: { type: 'illustrate_stock', newsId: id, title, category: 'tech' }, ack, retry: () => {} }] });
    await handleNewsQueue(mk(10, 'Same topic A') as any, env);
    await handleNewsQueue(mk(11, 'Same topic B') as any, env);
    await handleNewsQueue(mk(12, 'Same topic C') as any, env);

    const rows = await getDb(env).select().from(newsItems).where(eq(newsItems.id, 10)).all();
    // KV 缓存存的是 JSON 数组，且不同 newsId 应落到不同候选 URL（取模）
    const cached = cache.values().next().value as string;
    expect(Array.isArray(JSON.parse(cached))).toBe(true);
    const urls = new Set<string>();
    for (const id of [10, 11, 12]) {
      const r = await getDb(env).select().from(newsItems).where(eq(newsItems.id, id)).all();
      urls.add(r[0]?.image_url ?? '');
    }
    expect(urls.size).toBeGreaterThan(1);
  });
});

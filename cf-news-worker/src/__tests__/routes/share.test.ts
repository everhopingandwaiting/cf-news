import { describe, it, expect, beforeAll, vi } from 'vitest';
import { MockD1 } from '../mock-d1';
import { MOCK_ENV } from '../helpers';
import { handleShare } from '../../routes/share';
import { getDb, resetDb } from '../../db';

describe('Share handler', () => {
  it('returns null for non-share paths', async () => {
    const db = new MockD1();
    resetDb();
    // Initialize _db with our MockD1 before calling handler
    getDb({ DB: db } as any);
    const req = new Request('http://localhost/api/news');
    const res = await handleShare(req, { DB: db, ...MOCK_ENV } as any);
    expect(res).toBeNull();
  });

  it('returns null for non-numeric id', async () => {
    const db = new MockD1();
    resetDb();
    getDb({ DB: db } as any);
    const req = new Request('http://localhost/share/abc', { headers: { 'User-Agent': 'facebookexternalhit' } });
    const res = await handleShare(req, { DB: db, ...MOCK_ENV } as any);
    expect(res).toBeNull();
  });

  it('returns OG tags for crawler with valid id', async () => {
    vi.stubGlobal('fetch', async () => new Response('<html>SPA</html>'));
    const db = new MockD1();
    await db.seed('news_items', [{ id: 1, source_id: 1, title: 'Share Test', url: 'https://share/test', description: 'Desc', image_url: 'https://img', category: 'tech', is_deleted: 0 }]);
    await db.seed('news_summaries', [{ id: 1, news_id: 1, summary: 'AI summary' }]);
    resetDb();
    getDb({ DB: db } as any);

    const req = new Request('http://localhost/share/1', { headers: { 'User-Agent': 'facebookexternalhit' } });
    const res = await handleShare(req, { DB: db, ...MOCK_ENV } as any);
    expect(res).not.toBeNull();
    const text = await res!.text();
    expect(text).toContain('og:title');
    expect(text).toContain('Share Test');
  });
});

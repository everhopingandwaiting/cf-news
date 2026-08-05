import { describe, it, expect, beforeAll, vi } from 'vitest';
import { buildTestApp, request } from '../helpers';
import { resetDb } from '../../db';

let app: ReturnType<typeof buildTestApp>['app'];
let db: ReturnType<typeof buildTestApp>['db'];
let token: string;

beforeAll(async () => {
  resetDb();
  vi.stubGlobal('caches', { default: { match: async () => null, put: async () => {}, delete: async () => {} } });
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true })));
  const built = buildTestApp();
  app = built.app;
  db = built.db;

  const reg = await request(app, db, '/api/auth/register', {
    method: 'POST',
    body: { email: 'commenter@test.com', password: 'pass123', username: 'commenter' },
  });
  token = reg.body.token;
});

describe('Comments API', () => {
  it('GET /api/comments/1 - returns comments for news item', async () => {
    await db.seed('news_comments', [
      { id: 1, news_id: 1, user_id: 1, content: 'Great article!', is_deleted: 0 },
    ]);
    const { status, body } = await request(app, db, '/api/comments/1');
    expect(status).toBe(200);
    expect(body.comments).toHaveLength(1);
    expect(body.comments[0].content).toBe('Great article!');
    expect(body.comments[0].news_id).toBe(1);
    expect(body.comments[0].user_id).toBe(1);
    expect(body.comments[0].created_at).toBeTruthy();
    expect(typeof body.comments[0].created_at).toBe('string');
  });

  it('GET /api/comments/999 - returns empty for non-existent news', async () => {
    const { status, body } = await request(app, db, '/api/comments/999');
    expect(status).toBe(200);
    expect(body.comments).toHaveLength(0);
  });

  it('POST /api/comments/1 - requires auth', async () => {
    const { status } = await request(app, db, '/api/comments/1', {
      method: 'POST',
      body: { content: 'Nice!' },
    });
    expect(status).toBe(401);
  });

  it('POST /api/comments/1 - posts a comment with auth', async () => {
    const { status, body } = await request(app, db, '/api/comments/1', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { content: 'Nice article!' },
    });
    expect(status).toBe(200);
    expect(body.success).toBe(true);
  });

  it('POST /api/comments/1 - rejects empty content', async () => {
    const { status } = await request(app, db, '/api/comments/1', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { content: '   ' },
    });
    expect(status).toBe(400);
  });

  it('DELETE /api/comments/:commentId - requires auth', async () => {
    const { status } = await request(app, db, '/api/comments/1', { method: 'DELETE' });
    expect(status).toBe(401);
  });

  it('DELETE /api/comments/:commentId - deletes own comment only', async () => {
    await db.seed('news_comments', [
      { id: 10, news_id: 1, user_id: 1, content: 'Mine', is_deleted: 0 },
      { id: 11, news_id: 1, user_id: 2, content: 'Other', is_deleted: 0 },
    ]);

    const own = await request(app, db, '/api/comments/10', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(own.status).toBe(200);

    const other = await request(app, db, '/api/comments/11', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(other.status).toBe(200);

    const ownRow = await db.prepare('SELECT is_deleted FROM news_comments WHERE id = 10').first<any>();
    const otherRow = await db.prepare('SELECT is_deleted FROM news_comments WHERE id = 11').first<any>();
    expect(ownRow?.is_deleted).toBe(1);
    expect(otherRow?.is_deleted).toBe(0);
  });

  it('POST /api/comments/1 - rejects forged token (no signature)', async () => {
    // base64({"sub":1}) with a garbage third segment — must NOT pass auth
    const forged = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({
      sub: 1, email: 'commenter@test.com', role: 'user', exp: Math.floor(Date.now() / 1000) + 3600,
    }))}.${btoa('forged-signature')}`;
    const { status } = await request(app, db, '/api/comments/1', {
      method: 'POST',
      headers: { Authorization: `Bearer ${forged}` },
      body: { content: 'Impersonation attempt' },
    });
    expect(status).toBe(401);

    const rows = await db.prepare("SELECT COUNT(*) AS c FROM news_comments WHERE content = 'Impersonation attempt'").first<any>();
    expect(rows?.c).toBe(0);
  });

  it('DELETE /api/comments/:commentId - rejects forged token', async () => {
    await db.seed('news_comments', [
      { id: 20, news_id: 1, user_id: 2, content: 'Victim comment', is_deleted: 0 },
    ]);
    const forged = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({
      sub: 2, email: 'victim@test.com', role: 'user', exp: Math.floor(Date.now() / 1000) + 3600,
    }))}.${btoa('forged-signature')}`;
    const { status } = await request(app, db, '/api/comments/20', {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${forged}` },
    });
    expect(status).toBe(401);

    const row = await db.prepare('SELECT is_deleted FROM news_comments WHERE id = 20').first<any>();
    expect(row?.is_deleted).toBe(0);
  });

  it('POST /api/comments/1 - rejects content over 5000 chars', async () => {
    const { status } = await request(app, db, '/api/comments/1', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: { content: 'x'.repeat(5001) },
    });
    expect(status).toBe(400);
  });
});

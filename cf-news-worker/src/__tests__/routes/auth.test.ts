import { describe, it, expect, vi, beforeAll } from 'vitest';
import { buildTestApp, request, MOCK_ENV } from '../helpers';

describe('Auth API', () => {
  beforeAll(() => {
    // Turnstile siteverify is called on every register/login; stub it to pass.
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true })));
  });

  const { app, db } = buildTestApp();

  it('POST /api/auth/register - creates a new user', async () => {
    const { status, body } = await request(app, db, '/api/auth/register', {
      method: 'POST',
      body: { email: 'newuser@test.com', password: 'password123', username: 'newuser' },
    });
    expect(status).toBe(201);
    expect(body.token).toBeTruthy();
    expect(body.user.email).toBe('newuser@test.com');
    expect(body.user.id).toBeGreaterThan(0);
    expect(body.user.username).toBe('newuser');
  });

  it('POST /api/auth/register - rejects missing fields', async () => {
    const { status } = await request(app, db, '/api/auth/register', {
      method: 'POST',
      body: { email: 'test@test.com' },
    });
    expect(status).toBe(400);
  });

  it('POST /api/auth/register - requires turnstile token', async () => {
    // helpers injects a stub token; passing one explicitly with noTurnstile flag is
    // not supported by the helper, so hit the route directly with a raw body.
    const res = await app.fetch(new Request('http://localhost/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'noturnstile@test.com', password: 'pass123' }),
    }), { ...MOCK_ENV, DB: db }, { waitUntil: () => {}, passThroughOnException: () => {}, props: {} } as any);
    expect(res.status).toBe(403);
  });

  it('POST /api/auth/register - rejects duplicate email', async () => {
    await request(app, db, '/api/auth/register', {
      method: 'POST',
      body: { email: 'dup@test.com', password: 'pass123' },
    });
    const { status } = await request(app, db, '/api/auth/register', {
      method: 'POST',
      body: { email: 'dup@test.com', password: 'pass123' },
    });
    expect(status).toBe(409);
  });

  it('POST /api/auth/login - succeeds with valid credentials', async () => {
    await request(app, db, '/api/auth/register', {
      method: 'POST',
      body: { email: 'login@test.com', password: 'password123' },
    });
    const { status, body } = await request(app, db, '/api/auth/login', {
      method: 'POST',
      body: { email: 'login@test.com', password: 'password123' },
    });
    expect(status).toBe(200);
    expect(body.token).toBeTruthy();
  });

  it('POST /api/auth/login - fails with wrong password', async () => {
    await request(app, db, '/api/auth/register', {
      method: 'POST',
      body: { email: 'wrongpw@test.com', password: 'password123' },
    });
    const { status } = await request(app, db, '/api/auth/login', {
      method: 'POST',
      body: { email: 'wrongpw@test.com', password: 'wrongpassword' },
    });
    expect(status).toBe(401);
  });

  it('POST /api/auth/login - locks account after repeated failures', async () => {
    await request(app, db, '/api/auth/register', {
      method: 'POST',
      body: { email: 'locked@test.com', password: 'password123' },
    });

    for (let i = 0; i < 5; i++) {
      const { status } = await request(app, db, '/api/auth/login', {
        method: 'POST',
        body: { email: 'locked@test.com', password: 'wrongpassword' },
      });
      expect(status).toBe(401);
    }

    const { status, body } = await request(app, db, '/api/auth/login', {
      method: 'POST',
      body: { email: 'locked@test.com', password: 'password123' },
    });
    expect(status).toBe(429);
    expect(body.error).toContain('登录失败次数过多');
  });

  it('POST /api/auth/login - clears failure counter after successful login', async () => {
    await request(app, db, '/api/auth/register', {
      method: 'POST',
      body: { email: 'clearfail@test.com', password: 'password123' },
    });

    await request(app, db, '/api/auth/login', {
      method: 'POST',
      body: { email: 'clearfail@test.com', password: 'wrongpassword' },
    });

    const ok = await request(app, db, '/api/auth/login', {
      method: 'POST',
      body: { email: 'clearfail@test.com', password: 'password123' },
    });
    expect(ok.status).toBe(200);

    for (let i = 0; i < 4; i++) {
      const { status } = await request(app, db, '/api/auth/login', {
        method: 'POST',
        body: { email: 'clearfail@test.com', password: 'wrongpassword' },
      });
      expect(status).toBe(401);
    }

    const stillAllowed = await request(app, db, '/api/auth/login', {
      method: 'POST',
      body: { email: 'clearfail@test.com', password: 'password123' },
    });
    expect(stillAllowed.status).toBe(200);
  });

  it('GET /api/auth/me - returns user info with valid token', async () => {
    const { body: regBody } = await request(app, db, '/api/auth/register', {
      method: 'POST',
      body: { email: 'me@test.com', password: 'password123' },
    });
    const { status, body } = await request(app, db, '/api/auth/me', {
      headers: { 'Authorization': `Bearer ${regBody.token}` },
    });
    expect(status).toBe(200);
    expect(body.user.email).toBe('me@test.com');
  });

  it('GET /api/auth/me - rejects invalid token', async () => {
    const invalidToken = `${btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))}.${btoa(JSON.stringify({
      sub: 1,
      email: 'me@test.com',
      role: 'user',
      exp: Math.floor(Date.now() / 1000) + 3600,
    }))}.${btoa('bad-signature')}`;
    const { status } = await request(app, db, '/api/auth/me', {
      headers: { 'Authorization': `Bearer ${invalidToken}` },
    });
    expect(status).toBe(401);
  });
});

import { describe, it, expect } from 'vitest';
import { buildTestApp, request } from '../helpers';

describe('Auth API', () => {
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
    const { status } = await request(app, db, '/api/auth/me', {
      headers: { 'Authorization': 'Bearer invalid-token' },
    });
    expect(status).toBe(401);
  });
});

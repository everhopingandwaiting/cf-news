import { describe, it, expect } from 'vitest';
import { buildTestApp, request } from '../helpers';

describe('Health endpoint', () => {
  const { app, db } = buildTestApp();

  it('GET /api/health returns 200', async () => {
    const { status, body } = await request(app, db, '/api/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
  });
});

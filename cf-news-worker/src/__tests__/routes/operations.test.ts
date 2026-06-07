import { describe, it, expect, beforeAll, vi } from 'vitest';
import { buildTestApp, request } from '../helpers';
import { resetDb } from '../../db';

let app: ReturnType<typeof buildTestApp>['app'];
let db: ReturnType<typeof buildTestApp>['db'];

beforeAll(() => {
  resetDb();
  vi.stubGlobal('caches', { default: { match: async () => null, put: async () => {}, delete: async () => {} } });
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true })));
  const built = buildTestApp();
  app = built.app;
  db = built.db;
});

describe('Operations API', () => {
  it('POST /api/fetch - triggers fetch', async () => {
    const { status } = await request(app, db, '/api/fetch', { method: 'POST' });
    expect(status).toBe(200);
  });

  it('POST /api/translate - validates params', async () => {
    const { status } = await request(app, db, '/api/translate', {
      method: 'POST',
      body: {},
    });
    expect(status).toBe(400);
  });
});

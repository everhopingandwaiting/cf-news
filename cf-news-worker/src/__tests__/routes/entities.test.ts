import { describe, it, expect, beforeAll, vi } from 'vitest';
import { buildTestApp, request } from '../helpers';
import { resetDb } from '../../db';

let app: ReturnType<typeof buildTestApp>['app'];
let db: ReturnType<typeof buildTestApp>['db'];

beforeAll(async () => {
  resetDb();
  vi.stubGlobal('caches', { default: { match: async () => null, put: async () => {}, delete: async () => {} } });
  vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ success: true })));
  const built = buildTestApp();
  app = built.app;
  db = built.db;
  await db.exec(`
    CREATE TABLE IF NOT EXISTS news_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      news_id INTEGER NOT NULL,
      entity_type TEXT NOT NULL,
      entity_value TEXT NOT NULL,
      entity_context TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

describe('Entities API', () => {
  it('GET /api/news/1/entities - returns empty array when no entities', async () => {
    const { status, body } = await request(app, db, '/api/news/1/entities');
    expect(status).toBe(200);
    expect(body.entities).toEqual([]);
  });

  it('GET /api/news/1/entities - returns entities after insert', async () => {
    await db.seed('news_entities', [
      { id: 1, news_id: 1, entity_type: 'person', entity_value: 'Sam Altman', entity_context: 'OpenAI CEO' },
      { id: 2, news_id: 1, entity_type: 'organization', entity_value: 'OpenAI', entity_context: 'AI company' },
    ]);

    const { status, body } = await request(app, db, '/api/news/1/entities');
    expect(status).toBe(200);
    expect(body.entities).toEqual([
      { type: 'person', value: 'Sam Altman', context: 'OpenAI CEO' },
      { type: 'organization', value: 'OpenAI', context: 'AI company' },
    ]);
  });

  it('GET /api/news/999/entities - returns empty array for non-existent news', async () => {
    const { status, body } = await request(app, db, '/api/news/999/entities');
    expect(status).toBe(200);
    expect(body.entities).toEqual([]);
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { MockD1 } from '../mock-d1';
import { getDb, resetDb } from '../../db';
import { runRetention } from '../../services/retention';

beforeAll(() => {
  resetDb();
});

function newEnv() {
  return { DB: new MockD1() as unknown as D1Database };
}

const OLD_CONTENT_DATE = '2020-01-01 00:00:00';
const OLD_LOG_DATE = '2020-01-01 00:00:00';

describe('runRetention', () => {
  it('clears content on news_items older than 30 days, keeps fresh content', async () => {
    resetDb();
    const env = newEnv();
    const db = getDb(env);
    await db.run(sql`
      INSERT INTO news_items (id, source_id, title, url, category, is_deleted, content, created_at)
      VALUES
        (1, 1, 'Old with content', 'https://old.example/1', 'tech', 0, 'old body', ${OLD_CONTENT_DATE}),
        (2, 1, 'Fresh with content', 'https://fresh.example/2', 'tech', 0, 'fresh body', ${new Date().toISOString()}),
        (3, 1, 'Old without content', 'https://old.example/3', 'tech', 0, NULL, ${OLD_CONTENT_DATE})
    `);

    const result = await runRetention(env);
    expect(result.contentCleared).toBe(1);
    expect(result.logsDeleted).toBe(0);
    expect(result.batches).toBeGreaterThanOrEqual(2);

    const rows = await db.all(sql`SELECT id, content FROM news_items ORDER BY id`);
    const byId = new Map(rows.map((r: any) => [Number(r.id), r.content]));
    expect(byId.get(1)).toBeNull();
    expect(byId.get(2)).toBe('fresh body');
    expect(byId.get(3)).toBeNull();
  });

  it('deletes ai_call_log rows older than 7 days, keeps fresh rows', async () => {
    resetDb();
    const env = newEnv();
    const db = getDb(env);
    await db.run(sql`
      INSERT INTO ai_call_log (id, provider, model, created_at)
      VALUES
        (1, 'groq', 'old-model', ${OLD_LOG_DATE}),
        (2, 'groq', 'fresh-model', ${new Date().toISOString()})
    `);

    const result = await runRetention(env);
    expect(result.logsDeleted).toBe(1);
    expect(result.contentCleared).toBe(0);

    const rows: any[] = await db.all(sql`SELECT id, model FROM ai_call_log`);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].id)).toBe(2);
    expect(rows[0].model).toBe('fresh-model');
  });

  it('reports zero changes on empty tables', async () => {
    resetDb();
    const env = newEnv();
    const result = await runRetention(env);
    expect(result.contentCleared).toBe(0);
    expect(result.logsDeleted).toBe(0);
    expect(result.batches).toBe(2);
  });
});

import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { MockD1 } from '../mock-d1';
import { getDb, resetDb } from '../../db';
import { NEWS_ACTIVE_COUNT_KEY, getCache, setCache, remember, incrementCache } from '../../services/cache';

beforeAll(() => {
  resetDb();
});

function newEnv() {
  return { DB: new MockD1() as unknown as D1Database };
}

describe('kv_cache helpers', () => {
  it('setCache/getCache round-trips within TTL', async () => {
    resetDb();
    const db = getDb(newEnv());
    await setCache(db, 'roundtrip', 'v1', 60);
    expect(await getCache(db, 'roundtrip')).toBe('v1');
  });

  it('getCache returns null for expired or missing keys', async () => {
    resetDb();
    const db = getDb(newEnv());
    await setCache(db, 'exp', 'x', 60);
    await db.run(sql`UPDATE kv_cache SET expires_at = 0 WHERE cache_key = 'exp'`);
    expect(await getCache(db, 'exp')).toBeNull();
    expect(await getCache(db, 'missing')).toBeNull();
  });

  it('remember computes once and serves the cached value afterwards', async () => {
    resetDb();
    const db = getDb(newEnv());
    let calls = 0;
    expect(await remember(db, 'r1', 60, async () => { calls++; return 42; })).toBe(42);
    expect(await remember(db, 'r1', 60, async () => { calls++; return 99; })).toBe(42);
    expect(calls).toBe(1);
  });

  it('incrementCache accumulates and an expired counter gets recomputed', async () => {
    resetDb();
    const db = getDb(newEnv());
    await setCache(db, NEWS_ACTIVE_COUNT_KEY, '5', 3600);
    await incrementCache(db, NEWS_ACTIVE_COUNT_KEY, 3);
    expect(await getCache(db, NEWS_ACTIVE_COUNT_KEY)).toBe('8');

    // TTL 过期后 remember 重算真实值（自愈语义）
    await db.run(sql`UPDATE kv_cache SET expires_at = 0 WHERE cache_key = ${NEWS_ACTIVE_COUNT_KEY}`);
    expect(await remember(db, NEWS_ACTIVE_COUNT_KEY, 60, async () => 7)).toBe(7);
  });

  it('incrementCache ignores non-positive amounts', async () => {
    resetDb();
    const db = getDb(newEnv());
    await setCache(db, 'zero', '0', 60);
    await incrementCache(db, 'zero', 0);
    expect(await getCache(db, 'zero')).toBe('0');
  });
});
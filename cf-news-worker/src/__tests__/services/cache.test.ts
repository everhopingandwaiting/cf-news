import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { MockD1 } from '../mock-d1';
import { getDb, resetDb } from '../../db';
import { NEWS_ACTIVE_COUNT_KEY, getCache, setCache, remember, incrementCache, clearMemCache } from '../../services/cache';

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

  it('remember tolerates cache read/write failures — 写配额耗尽时只读端点不 500，内存层承接', async () => {
    resetDb();
    const env = newEnv();
    const db = getDb(env);
    // 模拟平台级写拒绝：缓存表不可用 → getCache/setCache 都抛错
    await db.run(sql`DROP TABLE kv_cache`);
    let calls = 0;
    const compute = async () => { calls++; return 'ok'; };
    // 读失败跳过缓存、写失败静默吞掉，照常返回计算值
    expect(await remember(db, 'robust', 60, compute)).toBe('ok');
    expect(calls).toBe(1);
    // 内存层承接后续请求：kv 写不进也只算一次（防全表 COUNT 风暴打爆读配额）
    expect(await remember(db, 'robust', 60, compute)).toBe('ok');
    expect(await remember(db, 'robust', 60, compute)).toBe('ok');
    expect(calls).toBe(1);
    // clearMemCache 后强制重算（seed 钩子/request 钩子同款语义）
    clearMemCache();
    expect(await remember(db, 'robust', 60, compute)).toBe('ok');
    expect(calls).toBe(2);
  });
});
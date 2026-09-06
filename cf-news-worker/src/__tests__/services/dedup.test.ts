import { describe, it, expect, beforeEach } from 'vitest';
import { MockD1 } from '../mock-d1';
import { resetDb } from '../../db';
import { checkDuplicate, storeDedupHash } from '../../services/dedup';
import type { Bindings } from '../../types';

let db: MockD1;

function makeEnv(overrides: Partial<Bindings> = {}): Bindings {
  return {
    DB: db,
    VECTORIZE: { query: async () => ({ count: 0, matches: [] }), upsert: async () => {} },
    AI: {
      run: async () => ({ data: [[0.1, 0.2, 0.3]] }),
    },
    ...overrides,
  } as Bindings;
}

// storeDedupHash UPDATEs an existing news_items row, so every store target must exist first
async function seedNewsItem(id: number, title: string) {
  await db.seed('news_items', [
    { id, source_id: 1, title, url: `https://example.com/${id}`, is_deleted: 0 },
  ]);
}

describe('dedup service', () => {
  beforeEach(() => {
    resetDb(); // getDb caches the first MockD1
    db = new MockD1();
  });

  it('migration 025 creates the dedup_hash index (no per-item full table scan)', async () => {
    const { results } = await db.prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'news_items' AND name = 'idx_news_dedup_hash'`
    ).all<{ name: string }>();
    expect(results.some(i => i.name === 'idx_news_dedup_hash')).toBe(true);
  });

  it('returns false when no existing article has the same hash', async () => {
    const isDup = await checkDuplicate(makeEnv(), 'Brand New Title', 'Fresh description');
    expect(isDup).toBe(false);
  });

  it('detects a duplicate by exact hash match', async () => {
    await seedNewsItem(1, 'Same Title');
    await storeDedupHash(makeEnv(), 1, 'Same Title', 'Same body');
    const isDup = await checkDuplicate(makeEnv(), 'Same Title', 'Same body');
    expect(isDup).toBe(true);
  });

  it('treats HTML-stripped, case-insensitive, whitespace-normalized text as duplicate', async () => {
    await seedNewsItem(1, 'Breaking News');
    await storeDedupHash(makeEnv(), 1, 'Breaking News', '<p>Some  body</p>');
    // Different formatting but same normalized content
    const isDup = await checkDuplicate(makeEnv(), 'BREAKING news', 'Some body');
    expect(isDup).toBe(true);
  });

  it('does not flag different content as duplicate', async () => {
    await seedNewsItem(1, 'Story about AI');
    await storeDedupHash(makeEnv(), 1, 'Story about AI', 'First article body');
    const isDup = await checkDuplicate(makeEnv(), 'Story about weather', 'Second article body');
    expect(isDup).toBe(false);
  });

  it('storeDedupHash writes the dedup_hash column', async () => {
    await seedNewsItem(42, 'Placeholder');
    await storeDedupHash(makeEnv(), 42, 'Hashable title');
    const row = await db.prepare('SELECT dedup_hash FROM news_items WHERE id = 42').first<any>();
    expect(row?.dedup_hash).toBeTruthy();
    expect(row.dedup_hash.length).toBeGreaterThan(0);
  });

  it('skips the vector check when VECTORIZE binding is absent', async () => {
    await seedNewsItem(1, 'No vector');
    await storeDedupHash(makeEnv({ VECTORIZE: undefined }), 1, 'No vector', 'binding');
    // Hash path still works without VECTORIZE
    const same = await checkDuplicate(makeEnv({ VECTORIZE: undefined }), 'No vector', 'binding');
    expect(same).toBe(true);
    // Vector path is skipped: hash miss returns false instead of throwing
    const different = await checkDuplicate(makeEnv({ VECTORIZE: undefined }), 'Something else', 'body');
    expect(different).toBe(false);
  });
});

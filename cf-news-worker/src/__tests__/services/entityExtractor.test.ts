import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MockD1 } from '../mock-d1';
import { resetDb } from '../../db';
import { extractEntities } from '../../services/entityExtractor';
import type { Bindings } from '../../types';

// Mock the AI provider boundary: getProviderOrder returns a stable chain and
// callAI returns whichever JSON the test sets, so no real network is involved.
vi.mock('../../services/aiProvider', () => ({
  callAI: vi.fn(),
  getProviderOrder: vi.fn(async () => ['groq']),
}));

import { callAI } from '../../services/aiProvider';

let db: MockD1;

function makeEnv(overrides: Partial<Bindings> = {}): Bindings {
  return { DB: db, ...overrides } as Bindings;
}

beforeEach(async () => {
  resetDb(); // getDb caches the first MockD1
  db = new MockD1();
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
  vi.mocked(callAI).mockReset();
  vi.mocked(callAI).mockResolvedValue(
    '[{"type":"person","value":"Sam Altman","context":"OpenAI CEO"},{"type":"organization","value":"OpenAI","context":"AI company"}]'
  );
});

describe('extractEntities', () => {
  it('writes valid entities to news_entities and replaces existing rows', async () => {
    await db.seed('news_entities', [
      { id: 1, news_id: 1, entity_type: 'person', entity_value: 'Stale Person', entity_context: 'old' },
    ]);

    await extractEntities(makeEnv(), 1, {
      title: 'OpenAI announces new model',
      description: 'Sam Altman unveiled the latest OpenAI model today.',
    });

    const rows = await db.prepare('SELECT * FROM news_entities WHERE news_id = 1').all();
    expect(rows.results.length).toBe(2);
    const byType = new Map(rows.results.map((r: any) => [r.entity_type, r.entity_value]));
    expect(byType.get('person')).toBe('Sam Altman');
    expect(byType.get('organization')).toBe('OpenAI');
  });

  it('skips write when AI returns unparsable content', async () => {
    vi.mocked(callAI).mockResolvedValue('抱歉，我无法提取实体。');

    await extractEntities(makeEnv(), 2, {
      title: 'Article with broken AI output',
      description: 'Some description that is long enough to pass the length gate.',
    });

    const rows = await db.prepare('SELECT * FROM news_entities WHERE news_id = 2').all();
    expect(rows.results.length).toBe(0);
  });

  it('skips write when AI returns null', async () => {
    vi.mocked(callAI).mockResolvedValue(null);

    await extractEntities(makeEnv(), 3, {
      title: 'Article whose AI call failed',
      description: 'Some description that is long enough to pass the length gate.',
    });

    const rows = await db.prepare('SELECT * FROM news_entities WHERE news_id = 3').all();
    expect(rows.results.length).toBe(0);
  });

  it('returns early for too-short content without calling AI', async () => {
    await extractEntities(makeEnv(), 4, { title: 'Hi', description: 'short' });

    expect(vi.mocked(callAI)).not.toHaveBeenCalled();
  });

  it('filters out invalid entity types and values', async () => {
    vi.mocked(callAI).mockResolvedValue(
      '[{"type":"person","value":"Valid Person","context":"ok"},{"type":"color","value":"Blue","context":"not a valid type"},{"type":"location","value":"  ","context":"empty value"}]'
    );

    await extractEntities(makeEnv(), 5, {
      title: 'Mixed valid and invalid entities',
      description: 'Some description that is long enough to pass the length gate.',
    });

    const rows = await db.prepare('SELECT * FROM news_entities WHERE news_id = 5').all();
    expect(rows.results.length).toBe(1);
    expect(rows.results[0].entity_type).toBe('person');
    expect(rows.results[0].entity_value).toBe('Valid Person');
  });
});

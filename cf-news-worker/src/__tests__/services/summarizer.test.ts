import { describe, it, expect, beforeEach } from 'vitest';
import { MockD1 } from '../mock-d1';
import { resetDb } from '../../db';
import { getSummaryBatchSize } from '../../services/summarizer';
import type { Bindings } from '../../types';

let db: MockD1;

function makeEnv(overrides: Record<string, any> = {}): Bindings {
  return {
    DB: db,
    AI: { run: async () => ({ response: 'mock ai' }) },
    ...overrides,
  } as unknown as Bindings;
}

describe('summarizer getSummaryBatchSize', () => {
  beforeEach(() => {
    resetDb(); // getDb caches the first MockD1
    db = new MockD1();
  });

  it('returns the default batch size when no models are configured', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'groq')");
    expect(await getSummaryBatchSize(makeEnv())).toBe(10);
  });

  it('sizes the batch to the smallest available context/max_output in the chain', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'groq,zen')");
    await db.seed('provider_models', [
      // 128K ctx / 4K out → byContext = floor(131072*0.6/1100) = 71, byOutput = floor(4096/120) = 34 → 34 → capped at 20
      { provider: 'groq', model_id: 'small-model', score: 90, enabled: 1, type: 'text', context_size: 131072, max_output: 4096 },
      // 1M ctx / 384K out → not the binding constraint
      { provider: 'zen', model_id: 'big-model', score: 95, enabled: 1, type: 'text', context_size: 1000000, max_output: 384000 },
    ]);
    expect(await getSummaryBatchSize(makeEnv())).toBe(20);
  });

  it('is limited by a small max_output', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'groq')");
    await db.seed('provider_models', [
      { provider: 'groq', model_id: 'tiny-out', score: 90, enabled: 1, type: 'text', context_size: 1000000, max_output: 600 },
    ]);
    // byOutput = floor(600/120) = 5
    expect(await getSummaryBatchSize(makeEnv())).toBe(5);
  });

  it('does not drop below 1 even for very small contexts', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'groq')");
    await db.seed('provider_models', [
      { provider: 'groq', model_id: 'tiny-ctx', score: 90, enabled: 1, type: 'text', context_size: 500, max_output: 120 },
    ]);
    expect(await getSummaryBatchSize(makeEnv())).toBe(1);
  });
});

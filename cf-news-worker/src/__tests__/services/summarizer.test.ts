import { describe, it, expect, beforeEach } from 'vitest';
import { MockD1 } from '../mock-d1';
import { resetDb } from '../../db';
import { getBatchSizes, getSummaryBatchSize } from '../../services/summarizer';
import type { Bindings } from '../../types';

let db: MockD1;

function makeEnv(overrides: Record<string, any> = {}): Bindings {
  return {
    DB: db,
    AI: { run: async () => ({ response: 'mock ai' }) },
    ...overrides,
  } as unknown as Bindings;
}

describe('summarizer batch sizing', () => {
  beforeEach(() => {
    resetDb(); // getDb caches the first MockD1
    db = new MockD1();
  });

  it('returns the default batch size when no models are configured', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'groq')");
    expect(await getBatchSizes(makeEnv())).toEqual({ large: 10, small: 10 });
    expect(await getSummaryBatchSize(makeEnv())).toBe(10);
  });

  it('sizes small batch to the weakest model and large batch to the strongest', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'groq,zen')");
    await db.seed('provider_models', [
      // 128K ctx / 4K out → small = min(floor(131072*0.6/1100), floor(4096/120), 20) = min(71, 34, 20) = 20
      { provider: 'groq', model_id: 'small-model', score: 90, enabled: 1, type: 'text', context_size: 131072, max_output: 4096 },
      // 1M ctx / 384K out → large = min(floor(1000000*0.6/1100), floor(384000/120), 40) = min(545, 3200, 40) = 40
      { provider: 'zen', model_id: 'big-model', score: 95, enabled: 1, type: 'text', context_size: 1000000, max_output: 384000 },
    ]);
    expect(await getBatchSizes(makeEnv())).toEqual({ large: 40, small: 20 });
  });

  it('caps both tiers by a small max_output', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'groq')");
    await db.seed('provider_models', [
      { provider: 'groq', model_id: 'tiny-out', score: 90, enabled: 1, type: 'text', context_size: 1000000, max_output: 600 },
    ]);
    // byOutput = floor(600/120) = 5 for both tiers (context is not binding)
    expect(await getBatchSizes(makeEnv())).toEqual({ large: 5, small: 5 });
  });

  it('collapses large to small when no available model can serve a large batch', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'groq,zen')");
    await db.seed('provider_models', [
      { provider: 'groq', model_id: 'small-model', score: 90, enabled: 1, type: 'text', context_size: 131072, max_output: 4096 },
    ]);
    // zen 全部模型不可用（限流标记/下线）→ 链上无 max_output ≥ 4800 的模型 → large 塌缩为 small
    await db.exec("DELETE FROM provider_models WHERE provider = 'zen'");
    expect(await getBatchSizes(makeEnv())).toEqual({ large: 20, small: 20 });
  });

  it('does not drop below 1 even for very small contexts', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'groq')");
    await db.seed('provider_models', [
      { provider: 'groq', model_id: 'tiny-ctx', score: 90, enabled: 1, type: 'text', context_size: 500, max_output: 120 },
    ]);
    expect(await getBatchSizes(makeEnv())).toEqual({ large: 1, small: 1 });
  });
});

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockD1 } from '../mock-d1';
import { resetDb } from '../../db';
import { refreshModelCatalog } from '../../services/modelRefresher';
import type { Bindings } from '../../types';

let db: MockD1;

function makeEnv(overrides: Record<string, any> = {}): Bindings {
  return {
    DB: db,
    AI: { run: async () => ({ response: 'mock ai' }) },
    ...overrides,
  } as unknown as Bindings;
}

/** Seed a single synced provider and point provider_order at it (no cloudflare). */
async function seedProvider(
  provider = 'testprov',
  models: Array<Record<string, any>> = [],
  extraConfig: Record<string, string> = {},
) {
  await db.exec(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', '${provider}')`);
  for (const [k, v] of Object.entries(extraConfig)) {
    await db.exec(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('${k}', '${v}')`);
  }
  await db.seed('providers', [
    { name: provider, base_url: `https://${provider}.example.com/v1`, api_key_env: 'TEST_KEY', enabled: 1, expires_at: null },
  ]);
  if (models.length) {
    await db.seed('provider_models', models.map((m) => ({
      provider, score: 50, enabled: 1, type: 'text', context_size: 131072, max_output: 4096, ...m,
    })));
  }
}

/** fetch stub that routes by URL: /models → list, /chat/completions → probe. */
function stubFetch(env: Record<string, any>, models: Array<Record<string, any>>, probeOk = true) {
  const fetchMock = vi.fn(async (url: string | URL | Request, _init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('/models')) {
      return new Response(JSON.stringify({ data: models }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    if (u.endsWith('/chat/completions')) {
      if (!probeOk) return new Response('bad', { status: 500 });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }), {
        status: 200, headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('unexpected', { status: 404 });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('modelRefresher reconcile (目录校准)', () => {
  beforeEach(() => {
    resetDb();
    db = new MockD1();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enables nothing and inserts newly-discovered live models as disabled candidates', async () => {
    await seedProvider('testprov');
    stubFetch(makeEnv(), [{ id: 'brand-new-model', type: 'text' }]);
    const env = makeEnv({ TEST_KEY: 'key' });

    const result = await refreshModelCatalog(env);
    expect(result.reconciled).toContain('new:testprov/brand-new-model');

    const row = await db.prepare(
      "SELECT enabled, score FROM provider_models WHERE provider = 'testprov' AND model_id = 'brand-new-model'",
    ).first<any>();
    expect(row.enabled).toBe(0); // safe default: never auto-enable
    expect(row.score).toBe(60);  // below verified main models (80+)
  });

  it('disables catalog models that are no longer live', async () => {
    await seedProvider('testprov', [{ model_id: 'gone-model' }]);
    stubFetch(makeEnv(), [{ id: 'still-live', type: 'text' }]);
    const env = makeEnv({ TEST_KEY: 'key' });

    const result = await refreshModelCatalog(env);
    expect(result.reconciled).toContain('disable:testprov/gone-model');

    const row = await db.prepare(
      "SELECT enabled FROM provider_models WHERE provider = 'testprov' AND model_id = 'gone-model'",
    ).first<any>();
    expect(row.enabled).toBe(0);
  });

  it('skips a provider when no API key is present (getProviderInfo returns null)', async () => {
    await seedProvider('testprov');
    stubFetch(makeEnv(), [{ id: 'some-model', type: 'text' }]);
    const env = makeEnv({}); // TEST_KEY missing

    const result = await refreshModelCatalog(env);
    expect(result.reconciled).toEqual([]);
  });

  it('skips cloudflare provider entirely (uses Workers AI gateway)', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'testprov,cloudflare')");
    await db.seed('providers', [
      { name: 'testprov', base_url: 'https://testprov.example.com/v1', api_key_env: 'TEST_KEY', enabled: 1, expires_at: null },
      { name: 'cloudflare', base_url: 'https://cf.example.com', api_key_env: 'CF_KEY', enabled: 1, expires_at: null },
    ]);
    const fetchMock = stubFetch(makeEnv(), [{ id: 'cf-model', type: 'text' }]);
    const env = makeEnv({ TEST_KEY: 'key', CF_KEY: 'cf-key' });

    const result = await refreshModelCatalog(env);
    // only testprov's /models is probed; cloudflare URL never contacted
    const urls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/models')).map((c) => String(c[0]));
    expect(urls).toEqual(['https://testprov.example.com/v1/models']);
    expect(result.reconciled).toEqual(['new:testprov/cf-model']);
  });
});

describe('modelRefresher quality probe (质量探针)', () => {
  beforeEach(() => {
    resetDb();
    db = new MockD1();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('enables a candidate model when the real probe returns content', async () => {
    // pre-existing disabled candidate in catalog
    await seedProvider('testprov', [{ model_id: 'candidate', enabled: 0, type: 'text' }]);
    stubFetch(makeEnv(), [{ id: 'candidate', type: 'text' }], true);
    const env = makeEnv({ TEST_KEY: 'key' });

    const result = await refreshModelCatalog(env);
    expect(result.probed).toContain('enable:testprov/candidate');

    const row = await db.prepare(
      "SELECT enabled FROM provider_models WHERE provider = 'testprov' AND model_id = 'candidate'",
    ).first<any>();
    expect(row.enabled).toBe(1);

    // probe timestamp recorded so we don't retry the same candidate every run
    const ts = await db.prepare(
      "SELECT value FROM app_config WHERE key = 'model_sync_probed:testprov:candidate'",
    ).first<any>();
    expect(Number(ts.value)).toBeGreaterThan(0);
  });

  it('keeps a candidate disabled when the probe fails', async () => {
    await seedProvider('testprov', [{ model_id: 'candidate', enabled: 0, type: 'text' }]);
    stubFetch(makeEnv(), [{ id: 'candidate', type: 'text' }], false);
    const env = makeEnv({ TEST_KEY: 'key' });

    const result = await refreshModelCatalog(env);
    expect(result.probed).toContain('keep-disabled:testprov/candidate');

    const row = await db.prepare(
      "SELECT enabled FROM provider_models WHERE provider = 'testprov' AND model_id = 'candidate'",
    ).first<any>();
    expect(row.enabled).toBe(0);
  });

  it('respects probe cooldown: does not re-probe a model probed within the cooldown window', async () => {
    await seedProvider('testprov', [{ model_id: 'candidate', enabled: 0, type: 'text' }]);
    // mark as probed "just now" so cooldown (86400s) not yet elapsed
    await db.exec(
      "INSERT OR REPLACE INTO app_config (key, value) VALUES ('model_sync_probed:testprov:candidate', '9999999999')",
    );
    const fetchMock = stubFetch(makeEnv(), [{ id: 'candidate', type: 'text' }], true);
    const env = makeEnv({ TEST_KEY: 'key' });

    const result = await refreshModelCatalog(env);
    expect(result.probed).toEqual([]);
    // /models was probed but /chat/completions never called (cooldown skipped the quality probe)
    const chatCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/chat/completions'));
    expect(chatCalls).toHaveLength(0);
  });

  it('respects model_sync_max_probes throttle across the whole run', async () => {
    await seedProvider('testprov', [
      { model_id: 'cand-1', enabled: 0, type: 'text' },
      { model_id: 'cand-2', enabled: 0, type: 'text' },
      { model_id: 'cand-3', enabled: 0, type: 'text' },
    ]);
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('model_sync_max_probes', '2')");
    const fetchMock = stubFetch(makeEnv(), [
      { id: 'cand-1', type: 'text' }, { id: 'cand-2', type: 'text' }, { id: 'cand-3', type: 'text' },
    ], true);
    const env = makeEnv({ TEST_KEY: 'key' });

    const result = await refreshModelCatalog(env);
    // only 2 chat/completions probes issued despite 3 candidates
    const chatCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/chat/completions'));
    expect(chatCalls).toHaveLength(2);
    expect(result.probed).toHaveLength(2);
  });

  it('gives a free candidate the free score bonus when enabled', async () => {
    await seedProvider('testprov', [{ model_id: 'free-model', enabled: 0, type: 'text' }]);
    stubFetch(makeEnv(), [{ id: 'free-model', type: 'text', pricing: { prompt: '0' } }], true);
    const env = makeEnv({ TEST_KEY: 'key' });

    const result = await refreshModelCatalog(env);
    expect(result.probed).toContain('enable:testprov/free-model');

    const row = await db.prepare(
      "SELECT enabled, score FROM provider_models WHERE provider = 'testprov' AND model_id = 'free-model'",
    ).first<any>();
    expect(row.enabled).toBe(1);
    // baseline 60 + free bonus 20
    expect(row.score).toBe(80);
  });

  it('probes free candidates before paid ones when probe budget is limited', async () => {
    await seedProvider('testprov', [
      { model_id: 'paid-model', enabled: 0, type: 'text' },
      { model_id: 'free-model', enabled: 0, type: 'text' },
    ]);
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('model_sync_max_probes', '1')");
    const fetchMock = stubFetch(makeEnv(), [
      { id: 'paid-model', type: 'text' },
      { id: 'free-model', type: 'text', pricing: { prompt: '0' } },
    ], true);
    const env = makeEnv({ TEST_KEY: 'key' });

    const result = await refreshModelCatalog(env);
    const chatCalls = fetchMock.mock.calls.filter((c) => String(c[0]).endsWith('/chat/completions'));
    expect(chatCalls).toHaveLength(1);
    expect(result.probed).toEqual(['enable:testprov/free-model']);

    const paid = await db.prepare(
      "SELECT enabled FROM provider_models WHERE provider = 'testprov' AND model_id = 'paid-model'",
    ).first<any>();
    expect(paid.enabled).toBe(0);
  });
});

describe('modelRefresher evidence pruning (证据裁剪)', () => {
  beforeEach(() => {
    resetDb();
    db = new MockD1();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('disables an enabled model with enough attempts but zero successes in the window', async () => {
    await seedProvider('testprov', [{ model_id: 'dead-model' }]);
    // 25 attempts, all failures, within the window
    await db.seed('ai_call_log', Array.from({ length: 25 }, () => ({
      provider: 'testprov', model: 'dead-model', success: 0, created_at: new Date().toISOString(),
    })));
    stubFetch(makeEnv(), [{ id: 'dead-model', type: 'text' }]);
    const env = makeEnv({ TEST_KEY: 'key' });

    const result = await refreshModelCatalog(env);
    expect(result.pruned).toContain('disable:testprov/dead-model');

    const row = await db.prepare(
      "SELECT enabled FROM provider_models WHERE provider = 'testprov' AND model_id = 'dead-model'",
    ).first<any>();
    expect(row.enabled).toBe(0);
  });

  it('does not prune models with below-threshold attempts or any success', async () => {
    await seedProvider('testprov', [{ model_id: 'low-attempts' }, { model_id: 'has-success' }]);
    // low-attempts: only 5 attempts (below min 20) → keep
    await db.seed('ai_call_log', Array.from({ length: 5 }, () => ({
      provider: 'testprov', model: 'low-attempts', success: 0, created_at: new Date().toISOString(),
    })));
    // has-success: 25 attempts but 1 success → keep
    await db.seed('ai_call_log', Array.from({ length: 25 }, (_, i) => ({
      provider: 'testprov', model: 'has-success', success: i === 0 ? 1 : 0, created_at: new Date().toISOString(),
    })));
    stubFetch(makeEnv(), [{ id: 'low-attempts', type: 'text' }, { id: 'has-success', type: 'text' }]);
    const env = makeEnv({ TEST_KEY: 'key' });

    const result = await refreshModelCatalog(env);
    expect(result.pruned).toEqual([]);
  });

  it('only prunes enabled models (disabled candidates stay untouched)', async () => {
    // candidate stays disabled (probe fails) yet has many failing log rows → must NOT be pruned
    await seedProvider('testprov', [{ model_id: 'disabled-model', enabled: 0, type: 'text' }]);
    await db.seed('ai_call_log', Array.from({ length: 30 }, () => ({
      provider: 'testprov', model: 'disabled-model', success: 0, created_at: new Date().toISOString(),
    })));
    stubFetch(makeEnv(), [{ id: 'disabled-model', type: 'text' }], false);
    const env = makeEnv({ TEST_KEY: 'key' });

    const result = await refreshModelCatalog(env);
    expect(result.probed).toContain('keep-disabled:testprov/disabled-model');
    expect(result.pruned).toEqual([]);

    const row = await db.prepare(
      "SELECT enabled FROM provider_models WHERE provider = 'testprov' AND model_id = 'disabled-model'",
    ).first<any>();
    expect(row.enabled).toBe(0);
  });
});

describe('modelRefresher provider rotation (游标轮转)', () => {
  beforeEach(() => {
    resetDb();
    db = new MockD1();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function seedMulti(providers: string[], perRun: number, budgetMs?: number) {
    await db.exec(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', '${providers.join(',')}')`);
    await db.exec(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('model_sync_providers_per_run', '${perRun}')`);
    if (budgetMs !== undefined) {
      await db.exec(`INSERT OR REPLACE INTO app_config (key, value) VALUES ('model_sync_budget_ms', '${budgetMs}')`);
    }
    for (const p of providers) {
      await db.seed('providers', [
        { name: p, base_url: `https://${p}.example.com/v1`, api_key_env: 'TEST_KEY', enabled: 1, expires_at: null },
      ]);
    }
  }

  const modelsCalled = (mock: any) => mock.mock.calls
    .filter((c: any[]) => String(c[0]).endsWith('/models'))
    .map((c: any[]) => String(c[0]));

  it('advances the cursor each run so every provider is eventually synced', async () => {
    await seedMulti(['p1', 'p2', 'p3'], 1);
    const fetchMock = stubFetch(makeEnv(), [{ id: 'a-model', type: 'text' }]);
    const env = makeEnv({ TEST_KEY: 'key' });

    await refreshModelCatalog(env);
    expect(modelsCalled(fetchMock)).toEqual(['https://p1.example.com/v1/models']);

    await refreshModelCatalog(env);
    expect(modelsCalled(fetchMock)).toEqual([
      'https://p1.example.com/v1/models',
      'https://p2.example.com/v1/models',
    ]);

    await refreshModelCatalog(env);
    expect(modelsCalled(fetchMock).at(-1)).toBe('https://p3.example.com/v1/models');

    // 第四轮回到第一家
    await refreshModelCatalog(env);
    expect(modelsCalled(fetchMock).at(-1)).toBe('https://p1.example.com/v1/models');

    const row = await db.prepare("SELECT value FROM app_config WHERE key = 'model_sync_cursor_provider'").first<any>();
    expect(row.value).toBe('p1');
  });

  it('still advances one provider when the time budget is already exhausted', async () => {
    await seedMulti(['p1', 'p2', 'p3'], 2, 0);
    const fetchMock = stubFetch(makeEnv(), [{ id: 'a-model', type: 'text' }]);

    await refreshModelCatalog(makeEnv({ TEST_KEY: 'key' }));
    // 预算 0 只允许第一家（否则会一家都跑不到，游标永远不动）
    expect(modelsCalled(fetchMock)).toEqual(['https://p1.example.com/v1/models']);
  });

  it('stops probing once the time budget is gone (per-provider probes cannot eat the budget)', async () => {
    await seedMulti(['p1', 'p2'], 2, 0);
    await db.seed('provider_models', [
      { provider: 'p1', model_id: 'cand', score: 60, enabled: 0, type: 'text', context_size: 131072, max_output: 4096 },
    ]);
    stubFetch(makeEnv(), [{ id: 'cand', type: 'text' }], true);

    const result = await refreshModelCatalog(makeEnv({ TEST_KEY: 'key' }));
    // 预算 0：目录照常校准，但探针一个都不打（否则单家 3×20s 会把 invocation 拖死）
    expect(result.probed).toEqual([]);
    const row = await db.prepare("SELECT enabled FROM provider_models WHERE model_id = 'cand'").first<any>();
    expect(row.enabled).toBe(0);
  });

  it('splits the probe budget across providers instead of letting the first one consume it', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'p1,p2')");
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('model_sync_providers_per_run', '2')");
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('model_sync_max_probes', '2')");
    for (const p of ['p1', 'p2']) {
      await db.seed('providers', [
        { name: p, base_url: `https://${p}.example.com/v1`, api_key_env: 'TEST_KEY', enabled: 1, expires_at: null },
      ]);
      await db.seed('provider_models', [
        { provider: p, model_id: 'cand', score: 60, enabled: 0, type: 'text', context_size: 131072, max_output: 4096 },
      ]);
    }
    const fetchMock = stubFetch(makeEnv(), [{ id: 'cand', type: 'text' }], true);

    const result = await refreshModelCatalog(makeEnv({ TEST_KEY: 'key' }));
    expect(result.probed).toEqual(['enable:p1/cand', 'enable:p2/cand']);

    const enabled = await db.prepare(
      "SELECT COUNT(*) AS n FROM provider_models WHERE model_id = 'cand' AND enabled = 1",
    ).first<any>();
    expect(enabled.n).toBe(2);
  });
});

describe('modelRefresher global switch', () => {
  beforeEach(() => {
    resetDb();
    db = new MockD1();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('short-circuits and does nothing when model_sync_enabled=0', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'testprov')");
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('model_sync_enabled', '0')");
    await db.seed('providers', [
      { name: 'testprov', base_url: 'https://testprov.example.com/v1', api_key_env: 'TEST_KEY', enabled: 1, expires_at: null },
    ]);
    // fetch should never be called when disabled
    const fetchMock = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await refreshModelCatalog(makeEnv({ TEST_KEY: 'key' }));
    expect(result).toEqual({ reconciled: [], probed: [], pruned: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

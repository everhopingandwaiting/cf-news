import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockD1 } from '../mock-d1';
import { resetDb } from '../../db';
import {
  getConfig, getConfigInt, getProviderOrder, getModels, getModelSpecs, getAvailableModelSpecs,
  getProviderInfo, getFailed, markFailed, getAvailableModels, doOpenAICompat, doCF, callAI,
  markProviderFailed, isProviderBlocked,
} from '../../services/aiProvider';
import type { Bindings } from '../../types';

let db: MockD1;

function makeEnv(overrides: Record<string, any> = {}): Bindings {
  return {
    DB: db,
    AI: { run: async () => ({ response: 'mock ai' }) },
    ...overrides,
  } as unknown as Bindings;
}

describe('aiProvider config', () => {
  beforeEach(() => {
    resetDb(); // getDb caches the first MockD1
    db = new MockD1();
  });

  it('getConfig returns value for existing key and null for missing key', async () => {
    await db.seed('app_config', [{ key: 'summary_temperature', value: '0.5' }]);
    expect(await getConfig(makeEnv(), 'summary_temperature')).toBe('0.5');
    expect(await getConfig(makeEnv(), 'missing_key')).toBeNull();
  });

  it('getConfigInt falls back to default for missing or non-numeric values', async () => {
    expect(await getConfigInt(makeEnv(), 'summary_max_tokens', 300)).toBe(300);
    await db.seed('app_config', [
      { key: 'summary_max_tokens', value: '500' },
      { key: 'garbage', value: 'abc' },
    ]);
    expect(await getConfigInt(makeEnv(), 'summary_max_tokens', 300)).toBe(500);
    expect(await getConfigInt(makeEnv(), 'garbage', 300)).toBe(300);
  });

  it('getProviderOrder uses default when unset, configured order when set', async () => {
    // migration 004 seeds provider_order; remove it to exercise the default branch
    await db.prepare('DELETE FROM app_config WHERE key = ?').bind('provider_order').run();
    const def = await getProviderOrder(makeEnv());
    expect(def).toEqual(['groq', 'cloudflare', 'openrouter', 'nvidia', 'mango']);
    await db.seed('app_config', [{ key: 'provider_order', value: 'openrouter, nvidia ,groq' }]);
    expect(await getProviderOrder(makeEnv())).toEqual(['openrouter', 'nvidia', 'groq']);
  });
});

describe('aiProvider model/provider lookup', () => {
  beforeEach(() => {
    resetDb();
    db = new MockD1();
  });

  it('getModels filters by provider + enabled and sorts by score DESC', async () => {
    await db.seed('provider_models', [
      { provider: 'groq', model_id: 'model-low', score: 10, enabled: 1, type: 'text' },
      { provider: 'groq', model_id: 'model-high', score: 90, enabled: 1, type: 'text' },
      { provider: 'groq', model_id: 'model-disabled', score: 50, enabled: 0, type: 'text' },
      { provider: 'openrouter', model_id: 'other-provider', score: 99, enabled: 1, type: 'text' },
    ]);
    expect(await getModels(makeEnv(), 'groq')).toEqual(['model-high', 'model-low']);
  });

  it('getModels supports type filter', async () => {
    await db.seed('provider_models', [
      { provider: 'testprov', model_id: 'test-text', score: 50, enabled: 1, type: 'text' },
      { provider: 'testprov', model_id: 'test-image', score: 60, enabled: 1, type: 'image' },
    ]);
    expect(await getModels(makeEnv(), 'testprov', 'image')).toEqual(['test-image']);
  });

  it('getModelSpecs returns context_size/max_output and falls back to DB defaults when unset', async () => {
    // 用自定义 provider，避免 migration 014/015 预置的 zen 模型干扰断言
    await db.seed('provider_models', [
      { provider: 'testprov', model_id: 'big-model', score: 95, enabled: 1, type: 'text', context_size: 1000000, max_output: 384000 },
      // 未显式设置 context_size/max_output → 数据库默认 131072/4096
      { provider: 'testprov', model_id: 'default-model', score: 80, enabled: 1, type: 'text' },
    ]);
    expect(await getModelSpecs(makeEnv(), 'testprov')).toEqual([
      { model_id: 'big-model', context_size: 1000000, max_output: 384000 },
      { model_id: 'default-model', context_size: 131072, max_output: 4096 },
    ]);
  });

  it('getModelSpecs breaks score ties with paid models first (is_free=0 before is_free=1)', async () => {
    // 同分时付费模型必须排在免费模型前，避免限流/易失效的免费模型抢在主力前被调用，
    // 导致整 provider 被 429 级联封锁（回归测试，对应 aiProvider.ts 的 is_free ASC 排序）
    await db.seed('provider_models', [
      { provider: 'testprov', model_id: 'paid-tie', score: 80, enabled: 1, type: 'text', is_free: 0 },
      { provider: 'testprov', model_id: 'free-tie', score: 80, enabled: 1, type: 'text', is_free: 1 },
      { provider: 'testprov', model_id: 'free-lower', score: 70, enabled: 1, type: 'text', is_free: 1 },
      { provider: 'testprov', model_id: 'paid-lower', score: 70, enabled: 1, type: 'text', is_free: 0 },
    ]);
    expect(await getModels(makeEnv(), 'testprov')).toEqual(['paid-tie', 'free-tie', 'paid-lower', 'free-lower']);
  });

  it('getAvailableModelSpecs excludes failed models and returns specs in score order', async () => {
    await db.seed('provider_models', [
      { provider: 'groq', model_id: 'model-a', score: 90, enabled: 1, type: 'text', context_size: 131072, max_output: 4096 },
      { provider: 'groq', model_id: 'model-b', score: 80, enabled: 1, type: 'text', context_size: 262144, max_output: 8192 },
      { provider: 'groq', model_id: 'model-c', score: 70, enabled: 1, type: 'text', context_size: 131072, max_output: 4096 },
    ]);
    await markFailed(makeEnv(), 'model-b', 'groq');
    const specs = await getAvailableModelSpecs(makeEnv(), 'groq', 5);
    expect(specs.map(s => s.model_id)).toEqual(['model-a', 'model-c']);
    // model-a keeps its documented max_output; defaults are applied to missing
    expect(specs[0]!.max_output).toBe(4096);
  });

  it('getProviderInfo resolves api key from env, honors enabled and expiry', async () => {
    await db.seed('providers', [
      { name: 'groq', base_url: 'https://api.groq.com/openai/v1', api_key_env: 'GROQ_API_KEY', enabled: 1, expires_at: null },
      { name: 'expired', base_url: 'https://expired.example.com', api_key_env: 'EXPIRED_KEY', enabled: 1, expires_at: '2020-01-01T00:00:00Z' },
      { name: 'disabled', base_url: 'https://disabled.example.com', api_key_env: 'DISABLED_KEY', enabled: 0, expires_at: null },
      { name: 'nokey', base_url: 'https://nokey.example.com', api_key_env: 'MISSING_KEY', enabled: 1, expires_at: null },
    ]);
    const env = makeEnv({ GROQ_API_KEY: 'secret-key' });
    expect(await getProviderInfo(env, 'groq')).toEqual({ base_url: 'https://api.groq.com/openai/v1', api_key: 'secret-key' });
    expect(await getProviderInfo(env, 'expired')).toBeNull();
    expect(await getProviderInfo(env, 'disabled')).toBeNull();
    expect(await getProviderInfo(env, 'nokey')).toBeNull();
  });
});

describe('aiProvider failed-model tracking', () => {
  beforeEach(() => {
    resetDb();
    db = new MockD1();
  });

  it('markFailed then getFailed round-trips, filtered by provider prefix', async () => {
    await markFailed(makeEnv(), 'model-a', 'groq');
    expect(await getFailed(makeEnv(), 'groq')).toEqual(['model-a']);
    expect(await getFailed(makeEnv(), 'cloudflare')).toEqual([]);
    expect(await getFailed(makeEnv())).toEqual(['groq:model-a']);
  });

  it('getFailed drops entries older than TTL', async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
      await markFailed(makeEnv(), 'model-a', 'groq');
      // 901s later: default TTL is 900s
      vi.setSystemTime(new Date('2024-01-01T00:15:01Z'));
      expect(await getFailed(makeEnv(), 'groq')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('getAvailableModels excludes failed models and respects limit', async () => {
    await db.seed('provider_models', [
      { provider: 'groq', model_id: 'model-a', score: 90, enabled: 1, type: 'text' },
      { provider: 'groq', model_id: 'model-b', score: 80, enabled: 1, type: 'text' },
      { provider: 'groq', model_id: 'model-c', score: 70, enabled: 1, type: 'text' },
    ]);
    await markFailed(makeEnv(), 'model-b', 'groq');
    expect(await getAvailableModels(makeEnv(), 'groq', 5)).toEqual(['model-a', 'model-c']);
    expect(await getAvailableModels(makeEnv(), 'groq', 1)).toEqual(['model-a']);
  });

  it('markProviderFailed blocks the whole provider but not others', async () => {
    await db.seed('provider_models', [
      { provider: 'zen', model_id: 'zen-free-1', score: 90, enabled: 1, type: 'text' },
      { provider: 'zen', model_id: 'zen-free-2', score: 80, enabled: 1, type: 'text' },
      { provider: 'groq', model_id: 'groq-model', score: 90, enabled: 1, type: 'text' },
    ]);
    await markProviderFailed(makeEnv(), 'zen');
    expect(await isProviderBlocked(makeEnv(), 'zen')).toBe(true);
    expect(await isProviderBlocked(makeEnv(), 'groq')).toBe(false);
    expect(await getModels(makeEnv(), 'zen')).toEqual([]);
    expect(await getAvailableModels(makeEnv(), 'zen', 5)).toEqual([]);
    expect(await getAvailableModelSpecs(makeEnv(), 'zen', 5)).toEqual([]);
    expect(await getModels(makeEnv(), 'groq')).toEqual(['groq-model']);
  });

  it('provider block expires after the failed-model TTL', async () => {
    await db.seed('provider_models', [
      { provider: 'testprov', model_id: 'test-model-1', score: 90, enabled: 1, type: 'text' },
    ]);
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2024-01-01T00:00:00Z'));
      await markProviderFailed(makeEnv(), 'testprov');
      expect(await isProviderBlocked(makeEnv(), 'testprov')).toBe(true);
      vi.setSystemTime(new Date('2024-01-01T00:15:01Z'));
      expect(await isProviderBlocked(makeEnv(), 'testprov')).toBe(false);
      expect(await getModels(makeEnv(), 'testprov')).toEqual(['test-model-1']);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('aiProvider direct calls', () => {
  beforeEach(() => {
    resetDb();
    db = new MockD1();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('doOpenAICompat returns content, logs the call, and does not markFailed on success', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(
      JSON.stringify({ choices: [{ message: { content: 'hello world' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await doOpenAICompat(makeEnv(), 'groq', 'https://api.groq.com/openai/v1/', 'key', 'model-a', [{ role: 'user', content: 'hi' }]);
    expect(result).toBe('hello world');

    // trailing slash normalized to /chat/completions
    const calledUrl = (fetchMock.mock.calls[0]![0] as string);
    expect(calledUrl).toBe('https://api.groq.com/openai/v1/chat/completions');

    const log = await db.prepare('SELECT * FROM ai_call_log').first<any>();
    expect(log.provider).toBe('groq');
    expect(log.model).toBe('model-a');
    expect(log.success).toBe(1);
    expect(log.response_length).toBe(11);
    // success must NOT be marked failed
    expect(await getFailed(makeEnv(), 'groq')).toEqual([]);
  });

  it('doOpenAICompat clamps max_tokens by the model max_output cap', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(
      JSON.stringify({ choices: [{ message: { content: 'clamped' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await doOpenAICompat(
      makeEnv(), 'groq', 'https://api.groq.com/openai/v1', 'key', 'model-a',
      [{ role: 'user', content: 'hi' }],
      { max_tokens: 500, max_output: 100 },
    );

    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.max_tokens).toBe(100);
  });

  it('doOpenAICompat keeps requested max_tokens when under the model max_output', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(
      JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    await doOpenAICompat(
      makeEnv(), 'groq', 'https://api.groq.com/openai/v1', 'key', 'model-a',
      [{ role: 'user', content: 'hi' }],
      { max_tokens: 100, max_output: 500 },
    );

    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.max_tokens).toBe(100);
  });

  it('doOpenAICompat marks failed and returns null on HTTP error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const result = await doOpenAICompat(makeEnv(), 'groq', 'https://api.groq.com/openai/v1', 'key', 'model-a', [{ role: 'user', content: 'hi' }]);
    expect(result).toBeNull();
    expect(await getFailed(makeEnv(), 'groq')).toEqual(['model-a']);
    const log = await db.prepare('SELECT * FROM ai_call_log').first<any>();
    expect(log.success).toBe(0);
    expect(log.error).toContain('HTTP 500');
  });

  it('doOpenAICompat marks failed and returns null on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const result = await doOpenAICompat(makeEnv(), 'groq', 'https://api.groq.com/openai/v1', 'key', 'model-a', [{ role: 'user', content: 'hi' }]);
    expect(result).toBeNull();
    expect(await getFailed(makeEnv(), 'groq')).toEqual(['model-a']);
  });

  it('doOpenAICompat cools only the model on HTTP 429 rate limit, not the whole provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"message":"Rate limit reached"}}', { status: 429 })));
    const result = await doOpenAICompat(makeEnv(), 'zen', 'https://opencode.ai/zen/v1', 'key', 'free-model', [{ role: 'user', content: 'hi' }]);
    expect(result).toBeNull();
    expect(await isProviderBlocked(makeEnv(), 'zen')).toBe(false);
    expect(await getFailed(makeEnv(), 'zen')).toEqual(['free-model']);
  });

  it('doOpenAICompat cools only the model on "Free usage exceeded" body, not the whole provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Free usage exceeded', { status: 402 })));
    const result = await doOpenAICompat(makeEnv(), 'zen', 'https://opencode.ai/zen/v1', 'key', 'free-model', [{ role: 'user', content: 'hi' }]);
    expect(result).toBeNull();
    expect(await isProviderBlocked(makeEnv(), 'zen')).toBe(false);
  });

  it('doOpenAICompat only marks the model on 500, not the whole provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })));
    const result = await doOpenAICompat(makeEnv(), 'zen', 'https://opencode.ai/zen/v1', 'key', 'free-model', [{ role: 'user', content: 'hi' }]);
    expect(result).toBeNull();
    expect(await isProviderBlocked(makeEnv(), 'zen')).toBe(false);
    expect(await getFailed(makeEnv(), 'zen')).toEqual(['free-model']);
  });

  it('doCF extracts response text and logs the call', async () => {
    const result = await doCF(makeEnv(), '@cf/llama', [{ role: 'user', content: 'hi' }]);
    expect(result).toBe('mock ai');
    const log = await db.prepare('SELECT * FROM ai_call_log').first<any>();
    expect(log.provider).toBe('cloudflare');
    expect(log.success).toBe(1);
  });
});

describe('aiProvider callAI chain', () => {
  beforeEach(() => {
    resetDb();
    db = new MockD1();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls through to next provider when the first one fails', async () => {
    // 显式指定 provider 链，不依赖 migration 里的全局 provider_order
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'groq,cloudflare')");
    await db.seed('providers', [
      { name: 'groq', base_url: 'https://api.groq.com/openai/v1', api_key_env: 'GROQ_API_KEY', enabled: 1, expires_at: null },
    ]);
    await db.seed('provider_models', [
      { provider: 'groq', model_id: 'groq-model', score: 90, enabled: 1, type: 'text' },
      { provider: 'cloudflare', model_id: '@cf/llama', score: 90, enabled: 1, type: 'text' },
    ]);

    // groq returns HTTP error; cloudflare via env.AI.run succeeds
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad', { status: 500 })));
    const env = makeEnv({ GROQ_API_KEY: 'key' });

    const result = await callAI(env, 'summarize this');
    expect(result).toBe('mock ai');

    // groq failed and got marked; cloudflare succeeded
    expect(await getFailed(env, 'groq')).toEqual(['groq-model']);
    const { results: logs } = await db.prepare('SELECT provider, success FROM ai_call_log ORDER BY id').all<any>();
    expect(logs.map((l: any) => [l.provider, l.success])).toEqual([
      ['groq', 0],
      ['cloudflare', 1],
    ]);
  });

  it('returns null when every provider fails', async () => {
    await db.seed('providers', [
      { name: 'groq', base_url: 'https://api.groq.com/openai/v1', api_key_env: 'GROQ_API_KEY', enabled: 1, expires_at: null },
    ]);
    await db.seed('provider_models', [
      { provider: 'groq', model_id: 'groq-model', score: 90, enabled: 1, type: 'text' },
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('down'); }));

    const result = await callAI(makeEnv({ GROQ_API_KEY: 'key' }), 'summarize this');
    expect(result).toBeNull();
  });

  it('passes the per-model max_output cap into the request', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'groq')");
    await db.seed('providers', [
      { name: 'groq', base_url: 'https://api.groq.com/openai/v1', api_key_env: 'GROQ_API_KEY', enabled: 1, expires_at: null },
    ]);
    await db.seed('provider_models', [
      { provider: 'groq', model_id: 'groq-model', score: 90, enabled: 1, type: 'text', context_size: 131072, max_output: 500 },
    ]);

    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(
      JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const result = await callAI(makeEnv({ GROQ_API_KEY: 'key' }), 'summarize this', { max_tokens: 1000 });
    expect(result).toBe('ok');

    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.max_tokens).toBe(500);
  });

  it('skips models whose max_output is below min_max_output (large-batch routing)', async () => {
    await db.exec("INSERT OR REPLACE INTO app_config (key, value) VALUES ('provider_order', 'groq,zen')");
    await db.seed('providers', [
      { name: 'groq', base_url: 'https://api.groq.com/openai/v1', api_key_env: 'GROQ_API_KEY', enabled: 1, expires_at: null },
      { name: 'zen', base_url: 'https://opencode.ai/zen/v1', api_key_env: 'ZEN_API_KEY', enabled: 1, expires_at: null },
    ]);
    await db.seed('provider_models', [
      // 4K output — too small for a 40-article batch (needs 4800); must be skipped
      { provider: 'groq', model_id: 'groq-small', score: 90, enabled: 1, type: 'text', context_size: 131072, max_output: 4096 },
      // 384K output — the only model that can serve the large batch
      { provider: 'zen', model_id: 'zen-big', score: 95, enabled: 1, type: 'text', context_size: 1000000, max_output: 384000 },
    ]);

    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(
      JSON.stringify({ choices: [{ message: { content: 'large batch ok' } }] }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchMock);

    const env = makeEnv({ GROQ_API_KEY: 'key', ZEN_API_KEY: 'zen-key' });
    const result = await callAI(env, 'summarize these 40', { max_tokens: 4800, min_max_output: 4800 });
    expect(result).toBe('large batch ok');

    // only zen got the request; groq was filtered out
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toBe('https://opencode.ai/zen/v1/chat/completions');
    const body = JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body));
    expect(body.max_tokens).toBe(4800);
  });
});

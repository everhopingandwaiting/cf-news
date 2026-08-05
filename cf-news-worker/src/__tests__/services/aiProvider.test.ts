import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MockD1 } from '../mock-d1';
import { resetDb } from '../../db';
import {
  getConfig, getConfigInt, getProviderOrder, getModels, getProviderInfo,
  getFailed, markFailed, getAvailableModels, doOpenAICompat, doCF, callAI,
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
});

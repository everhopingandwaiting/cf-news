import { Bindings } from '../types';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { appConfig, providerModels, providers, aiCallLog } from '../db/schema';

const DEFAULT_FAILED_MODEL_TTL_SECONDS = 900;

export async function getConfig(env: Bindings, key: string): Promise<string | null> {
    const db = getDb(env);
    try {
        const row = await db.select({ value: appConfig.value })
            .from(appConfig)
            .where(eq(appConfig.key, key))
            .get();
        return row?.value || null;
    } catch {}
    return null;
}

export async function getConfigInt(env: Bindings, key: string, def: number): Promise<number> {
    const v = await getConfig(env, key);
    if (!v) return def;
    const parsed = parseInt(v, 10);
    return Number.isFinite(parsed) ? parsed : def;
}

export async function getProviderOrder(env: Bindings): Promise<string[]> {
    const order = await getConfig(env, 'provider_order');
    return order ? order.split(',').map(s => s.trim()) : ['groq', 'cloudflare', 'openrouter', 'nvidia', 'mango'];
}

export async function getModels(env: Bindings, provider: string, type?: string): Promise<string[]> {
    const db = getDb(env);
    try {
        const cond = type
            ? sql`provider = ${provider} AND enabled = 1 AND type = ${type}`
            : sql`provider = ${provider} AND enabled = 1`;
        const rows = await db.select({ model_id: providerModels.model_id })
            .from(providerModels)
            .where(cond)
            .orderBy(sql`score DESC`)
            .all();
        return rows.map(r => r.model_id);
    } catch (e) {
        console.error(`getModels error for ${provider}:`, e);
        return [];
    }
}

export async function getProviderInfo(env: Bindings, name: string): Promise<{ base_url: string; api_key: string } | null> {
    const db = getDb(env);
    try {
        const row = await db.select({
            base_url: providers.base_url,
            api_key_env: providers.api_key_env,
            expires_at: providers.expires_at,
        }).from(providers)
            .where(sql`name = ${name} AND enabled = 1`)
            .get();

        if (!row) return null;
        if (row.expires_at && new Date(row.expires_at) < new Date()) {
            console.log(`Provider ${name} expired at ${row.expires_at}`);
            return null;
        }
        let apiKey = '';
        if (row.api_key_env) {
            apiKey = (env as any)[row.api_key_env] || '';
        }
        if (!apiKey) return null;
        return { base_url: row.base_url, api_key: apiKey };
    } catch (e) {
        console.error(`getProviderInfo error for ${name}:`, e);
        return null;
    }
}

function failedModelKey(provider: string, model: string): string {
    return `${provider}:${model}`;
}

// Platform-level errors that are NOT the model's fault — must not poison the
// failed-model list. "Too many subrequests" fires when a single Worker
// invocation exceeds the subrequest cap (50 free / 1000 paid), which cascades
// into every subsequent AI attempt failing and getting blamed on the model.
function isInfraError(err: unknown): boolean {
    const msg = String(err);
    return msg.includes('Too many subrequests')
        || msg.includes('CPU time limit exceeded')
        || msg.includes('Subrequest');
}

export async function getFailed(env: Bindings, provider?: string): Promise<string[]> {
    const db = getDb(env);
    try {
        const row = await db.select({ value: appConfig.value })
            .from(appConfig)
            .where(eq(appConfig.key, 'ai_failed_models'))
            .get();
        if (!row) return [];
        const data = JSON.parse(row.value);
        if (Array.isArray(data)) return [];
        if (!data.models || typeof data.models !== 'object') return [];
        const now = Math.floor(Date.now() / 1000);
        const ttl = await getConfigInt(env, 'ai_failed_model_ttl_seconds', DEFAULT_FAILED_MODEL_TTL_SECONDS);
        return Object.entries(data.models)
            .filter(([, ts]) => now - (ts as number) < ttl)
            .map(([key]) => {
                if (!provider) return key;
                const prefix = `${provider}:`;
                return key.startsWith(prefix) ? key.slice(prefix.length) : '';
            })
            .filter(Boolean);
    } catch { return []; }
}

export async function markFailed(env: Bindings, model: string, provider: string): Promise<void> {
    try {
        const db = getDb(env);
        const now = Math.floor(Date.now() / 1000);
        const row = await db.select({ value: appConfig.value })
            .from(appConfig)
            .where(eq(appConfig.key, 'ai_failed_models'))
            .get();
        const models: Record<string, number> = {};
        if (row) {
            try {
                const data = JSON.parse(row.value);
                if (data.models && typeof data.models === 'object') {
                    Object.assign(models, data.models);
                }
            } catch {}
        }
        const ttl = await getConfigInt(env, 'ai_failed_model_ttl_seconds', DEFAULT_FAILED_MODEL_TTL_SECONDS);
        let changed = false;
        for (const [m, ts] of Object.entries(models)) {
            if (now - ts >= ttl) { delete models[m]; changed = true; }
        }
        const key = failedModelKey(provider, model);
        if (!models[key]) {
            models[key] = now;
            changed = true;
        }
        if (changed) {
            const entries = Object.entries(models)
                .sort(([, a], [, b]) => b - a)
                .slice(0, 50);
            const trimmed = Object.fromEntries(entries);
            await db.run(sql`INSERT OR REPLACE INTO app_config (key, value) VALUES ('ai_failed_models', ${JSON.stringify({ models: trimmed })})`);
        }
    } catch (e) {
        console.error('markFailed error:', e);
    }
}

export async function logAICall(env: Bindings, data: {
    provider: string; model?: string; news_id?: number; news_title?: string;
    prompt_length: number; response_length: number; response_preview?: string;
    duration_ms: number; success: boolean; error?: string;
}) {
    const db = getDb(env);
    try {
        await db.insert(aiCallLog).values({
            provider: data.provider,
            model: data.model || null,
            news_id: data.news_id || null,
            news_title: data.news_title || null,
            prompt_length: data.prompt_length,
            response_length: data.response_length,
            response_preview: data.response_preview?.substring(0, 200) || null,
            duration_ms: data.duration_ms,
            success: data.success ? 1 : 0,
            error: data.error || null,
        });
    } catch (e) { console.error('Log insert error:', e); }
}

async function getMaxModelsPerProvider(env: Bindings): Promise<number> {
    const configured = await getConfigInt(env, 'ai_max_models_per_provider', 2);
    return Math.min(Math.max(configured, 1), 5);
}

export async function getAvailableModels(env: Bindings, provider: string, limit: number, type?: string): Promise<string[]> {
    const failed = new Set(await getFailed(env, provider));
    return (await getModels(env, provider, type))
        .filter(model => !failed.has(model))
        .slice(0, limit);
}

export async function doOpenAICompat(
    env: Bindings, provider: string, baseUrl: string, apiKey: string,
    model: string, messages: { role: string; content: string }[],
    options?: { max_tokens?: number; temperature?: number; news_id?: number; news_title?: string }
): Promise<string | null> {
    const start = Date.now();
    const maxTokens = options?.max_tokens ?? (await getConfigInt(env, 'summary_max_tokens', 300));
    const temp = options?.temperature ?? parseFloat(await getConfig(env, 'summary_temperature') || '0.3');
    try {
        const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: temp }),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            const error = `HTTP ${res.status}: ${errText.substring(0, 500)}`;
            console.error(`${provider}/${model} error ${res.status}: ${errText}`);
            await logAICall(env, { provider, model, news_id: options?.news_id, news_title: options?.news_title,
                prompt_length: JSON.stringify(messages).length, response_length: 0, response_preview: errText,
                duration_ms: Date.now() - start, success: false, error });
            await markFailed(env, model, provider);
            return null;
        }
        const body: any = await res.json();
        const text = body?.choices?.[0]?.message?.content || '';
        await logAICall(env, { provider, model, news_id: options?.news_id, news_title: options?.news_title,
            prompt_length: JSON.stringify(messages).length, response_length: text.length, response_preview: text,
            duration_ms: Date.now() - start, success: !!text });
        if (!text) await markFailed(env, model, provider);
        return text || null;
    } catch (e: any) {
        await logAICall(env, { provider, model, news_id: options?.news_id, news_title: options?.news_title,
            prompt_length: JSON.stringify(messages).length, response_length: 0,
            duration_ms: Date.now() - start, success: false, error: String(e) });
        if (!isInfraError(e)) await markFailed(env, model, provider);
        return null;
    }
}

export async function doCF(
    env: Bindings, model: string, messages: { role: string; content: string }[],
    options?: { max_tokens?: number; temperature?: number; news_id?: number; news_title?: string }
): Promise<string | null> {
    const start = Date.now();
    const maxTokens = options?.max_tokens ?? (await getConfigInt(env, 'summary_max_tokens', 300));
    const temp = options?.temperature ?? parseFloat(await getConfig(env, 'summary_temperature') || '0.3');
    try {
        const r: any = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature: temp });
        const text = r?.response || r?.choices?.[0]?.message?.content || '';
        await logAICall(env, { provider: 'cloudflare', model, news_id: options?.news_id, news_title: options?.news_title,
            prompt_length: JSON.stringify(messages).length, response_length: text.length, response_preview: text,
            duration_ms: Date.now() - start, success: !!text });
        if (!text) await markFailed(env, model, 'cloudflare');
        return text || null;
    } catch (e: any) {
        await logAICall(env, { provider: 'cloudflare', model, news_id: options?.news_id, news_title: options?.news_title,
            prompt_length: JSON.stringify(messages).length, response_length: 0,
            duration_ms: Date.now() - start, success: false, error: String(e) });
        if (!isInfraError(e)) await markFailed(env, model, 'cloudflare');
        return null;
    }
}

export interface AIOptions {
    max_tokens?: number;
    temperature?: number;
    news_id?: number;
    news_title?: string;
    system_prompt?: string;
}

export async function callAI(env: Bindings, prompt: string, options?: AIOptions): Promise<string | null> {
    const messages = options?.system_prompt
        ? [{ role: 'system', content: options.system_prompt }, { role: 'user', content: prompt }]
        : [{ role: 'user', content: prompt }];

    const order = await getProviderOrder(env);
    const maxModels = await getMaxModelsPerProvider(env);

    for (const provider of order) {
        if (provider === 'cloudflare') {
            const models = await getAvailableModels(env, 'cloudflare', maxModels);
            for (const model of models) {
                const result = await doCF(env, model, messages, options);
                if (result) return result;
            }
        } else {
            const info = await getProviderInfo(env, provider);
            if (!info) continue;
            const models = await getAvailableModels(env, provider, maxModels);
            for (const model of models) {
                const result = await doOpenAICompat(env, provider, info.base_url, info.api_key, model, messages, options);
                if (result) return result;
            }
        }
    }
    return null;
}

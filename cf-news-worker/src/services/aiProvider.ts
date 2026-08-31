import { Bindings } from '../types';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { appConfig, providerModels, providers, aiCallLog } from '../db/schema';

const DEFAULT_FAILED_MODEL_TTL_SECONDS = 120;
// Key 失效（401/403）是 Provider 级问题：Key 属于整个 Provider，不是某个模型。
// 一旦 Key 无效/过期/无权，该 Provider 的每个模型都会同样失败，逐个撞墙纯属
// 白烧 subrequest。因此直接长时间（默认 7 天）禁用整条 Provider 链，直到手动
// 更换 Key 后手动解除禁用（或等待 TTL 到期自动恢复）。
const DEFAULT_PROVIDER_DISABLE_TTL_SECONDS = 7 * 24 * 60 * 60;

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

export interface ModelSpec {
    model_id: string;
    context_size: number;
    max_output: number;
}

export async function getModelSpecs(env: Bindings, provider: string, type?: string): Promise<ModelSpec[]> {
    const db = getDb(env);
    try {
        const cond = type
            ? sql`provider = ${provider} AND enabled = 1 AND type = ${type}`
            : sql`provider = ${provider} AND enabled = 1`;
        const rows = await db.select({
            model_id: providerModels.model_id,
            context_size: providerModels.context_size,
            max_output: providerModels.max_output,
        })
            .from(providerModels)
            .where(cond)
            .orderBy(sql`score DESC`)
            .all();
        return rows.map(r => ({
            model_id: r.model_id,
            context_size: r.context_size ?? 131072,
            max_output: r.max_output ?? 4096,
        }));
    } catch (e) {
        console.error(`getModelSpecs error for ${provider}:`, e);
        return [];
    }
}

export async function getModels(env: Bindings, provider: string, type?: string): Promise<string[]> {
    if (await isProviderDisabled(env, provider)) return [];
    if (await isProviderBlocked(env, provider)) return [];
    return (await getModelSpecs(env, provider, type)).map(s => s.model_id);
}

export async function getProviderInfo(env: Bindings, name: string): Promise<{ base_url: string; api_key: string } | null> {
    if (await isProviderDisabled(env, name)) {
        console.log(`Provider ${name} disabled (key invalid)`);
        return null;
    }
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

// Provider 级封锁：限流（HTTP 429 / "Free usage exceeded" 等）是整个 provider
// 的问题，不是单个模型的锅。用一个保留字模型名 `*` 标记整条 provider 链冻结，
// TTL 内 getAvailableModelSpecs/getModels 直接返回空，cron 的后续 batch 不再
// 逐个尝试该 provider 的其他模型（免费模型限流时逐个撞墙 = 白烧 subrequest）。
const PROVIDER_BLOCK_MODEL = '*';

export async function markProviderFailed(env: Bindings, provider: string): Promise<void> {
    await markFailed(env, PROVIDER_BLOCK_MODEL, provider);
}

export async function isProviderBlocked(env: Bindings, provider: string): Promise<boolean> {
    const failed = await getFailed(env, provider);
    return failed.includes(PROVIDER_BLOCK_MODEL);
}

// Key 失效持久化：存到独立的 `ai_provider_disabled` key（JSON { provider: epoch }），
// 与限流用的 `ai_failed_models` 分离，语义更清晰，也便于手动解除（删除该 key）。
async function readDisabled(env: Bindings): Promise<Record<string, number>> {
    try {
        const db = getDb(env);
        const row = await db.select({ value: appConfig.value })
            .from(appConfig)
            .where(eq(appConfig.key, 'ai_provider_disabled'))
            .get();
        if (row && typeof row.value === 'string' && row.value.startsWith('{')) {
            return JSON.parse(row.value);
        }
    } catch {}
    return {};
}

export async function isProviderDisabled(env: Bindings, provider: string): Promise<boolean> {
    const map = await readDisabled(env);
    if (!(provider in map)) return false;
    const ttl = await getConfigInt(env, 'ai_provider_disable_ttl_seconds', DEFAULT_PROVIDER_DISABLE_TTL_SECONDS);
    const now = Math.floor(Date.now() / 1000);
    return now - map[provider] < ttl;
}

export async function markProviderKeyFailed(env: Bindings, provider: string): Promise<void> {
    try {
        const db = getDb(env);
        const map = await readDisabled(env);
        map[provider] = Math.floor(Date.now() / 1000);
        await db.run(sql`INSERT OR REPLACE INTO app_config (key, value) VALUES ('ai_provider_disabled', ${JSON.stringify(map)})`);
    } catch (e) {
        console.error(`markProviderKeyFailed error for ${provider}:`, e);
    }
}

// 限流特征：HTTP 429，或响应体包含常见的 quota/rate-limit 文案。
// 命中即整条 provider 链冷却（markProviderFailed），而不是只冷却当前模型。
function isRateLimitError(status: number, body: string): boolean {
    if (status === 429) return true;
    const lower = body.toLowerCase();
    return lower.includes('rate limit')
        || lower.includes('rate_limit')
        || lower.includes('quota exceeded')
        || lower.includes('free usage exceeded')
        || lower.includes('too many requests')
        || lower.includes('insufficient_quota');
}

// Key 失效特征：HTTP 401/403，或响应体常见的鉴权失败文案。
// 命中即长期禁用整条 provider 链（markProviderKeyFailed），不是只冷却当前模型——
// Key 属于 Provider，任何模型用同一把 Key 都会同样失败。
function isKeyError(status: number, body: string): boolean {
    if (status === 401 || status === 403) return true;
    const lower = body.toLowerCase();
    return lower.includes('invalid api key')
        || lower.includes('unauthorized')
        || lower.includes('authentication failed')
        || lower.includes('invalid key')
        || lower.includes('forbidden');
}

// 模型级错误特征：HTTP 400/404，且响应体确认是「模型不存在/不可用/无效」，
// 而非请求本身的其他问题（如参数错误）。这类错误是单个模型的锅，只标记该模型。
function isModelError(status: number, body: string): boolean {
    if (status !== 400 && status !== 404) return false;
    const lower = body.toLowerCase();
    return lower.includes('model not found')
        || lower.includes('model_not_found')
        || lower.includes('does not exist')
        || lower.includes('model unavailable')
        || lower.includes('unknown model')
        || lower.includes('model not exist')
        || lower.includes('invalid model');
}

export async function logAICall(env: Bindings, data: {
    provider: string; model?: string; news_id?: number; news_title?: string;
    prompt_length: number; response_length: number; response_preview?: string;
    duration_ms: number; success: boolean; error?: string;
}) {
    // AI 调用遥测：非阻塞写入 Analytics Engine（provider/model/成功与否/耗时都在此作用域内）
    if (env.ANALYTICS) {
        env.ANALYTICS.writeDataPoint({
            indexes: [],
            blobs: ['ai_call', data.provider, data.model || '', data.success ? 'ok' : 'fail'],
            doubles: [data.duration_ms, 1],
        });
    }
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

export async function getAvailableModelSpecs(env: Bindings, provider: string, limit: number, type?: string): Promise<ModelSpec[]> {
    if (await isProviderDisabled(env, provider)) return [];
    if (await isProviderBlocked(env, provider)) return [];
    const failed = new Set(await getFailed(env, provider));
    return (await getModelSpecs(env, provider, type))
        .filter(spec => !failed.has(spec.model_id))
        .slice(0, limit);
}

export async function getAvailableModels(env: Bindings, provider: string, limit: number, type?: string): Promise<string[]> {
    return (await getAvailableModelSpecs(env, provider, limit, type)).map(s => s.model_id);
}

export async function doOpenAICompat(
    env: Bindings, provider: string, baseUrl: string, apiKey: string,
    model: string, messages: { role: string; content: string }[],
    options?: { max_tokens?: number; temperature?: number; news_id?: number; news_title?: string; max_output?: number; timeout_ms?: number }
): Promise<string | null> {
    const start = Date.now();
    const baseMaxTokens = options?.max_tokens ?? (await getConfigInt(env, 'summary_max_tokens', 300));
    const maxTokens = options?.max_output ? Math.min(baseMaxTokens, options.max_output) : baseMaxTokens;
    const temp = options?.temperature ?? parseFloat(await getConfig(env, 'summary_temperature') || '0.3');
    try {
        const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: temp }),
            signal: AbortSignal.timeout(options?.timeout_ms ?? 30000),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            const error = `HTTP ${res.status}: ${errText.substring(0, 500)}`;
            console.error(`${provider}/${model} error ${res.status}: ${errText}`);
            await logAICall(env, { provider, model, news_id: options?.news_id, news_title: options?.news_title,
                prompt_length: JSON.stringify(messages).length, response_length: 0, response_preview: errText,
                duration_ms: Date.now() - start, success: false, error });
            if (isKeyError(res.status, errText)) await markProviderKeyFailed(env, provider);
            else if (isModelError(res.status, errText)) await markFailed(env, model, provider);
            else if (isRateLimitError(res.status, errText)) await markProviderFailed(env, provider);
            else await markFailed(env, model, provider);
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
    options?: { max_tokens?: number; temperature?: number; news_id?: number; news_title?: string; max_output?: number }
): Promise<string | null> {
    const start = Date.now();
    const baseMaxTokens = options?.max_tokens ?? (await getConfigInt(env, 'summary_max_tokens', 300));
    const maxTokens = options?.max_output ? Math.min(baseMaxTokens, options.max_output) : baseMaxTokens;
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
    /** 只尝试 context_size ≥ 该值的模型（大 batch 场景） */
    min_context?: number;
    /** 只尝试 max_output ≥ 该值的模型（大 batch 场景，防输出截断） */
    min_max_output?: number;
    timeout_ms?: number;
}

export async function callAI(env: Bindings, prompt: string, options?: AIOptions): Promise<string | null> {
    const messages = options?.system_prompt
        ? [{ role: 'system', content: options.system_prompt }, { role: 'user', content: prompt }]
        : [{ role: 'user', content: prompt }];

    const order = await getProviderOrder(env);
    const maxModels = await getMaxModelsPerProvider(env);
    const { min_context, min_max_output } = options || {};

    for (const provider of order) {
        if (provider === 'cloudflare') {
            const specs = (await getAvailableModelSpecs(env, 'cloudflare', maxModels))
                .filter(s => (!min_context || s.context_size >= min_context) && (!min_max_output || s.max_output >= min_max_output));
            for (const spec of specs) {
                const result = await doCF(env, spec.model_id, messages, { ...options, max_output: spec.max_output });
                if (result) return result;
            }
        } else {
            const info = await getProviderInfo(env, provider);
            if (!info) continue;
            const specs = (await getAvailableModelSpecs(env, provider, maxModels))
                .filter(s => (!min_context || s.context_size >= min_context) && (!min_max_output || s.max_output >= min_max_output));
            for (const spec of specs) {
                const result = await doOpenAICompat(env, provider, info.base_url, info.api_key, spec.model_id, messages, { ...options, max_output: spec.max_output });
                if (result) return result;
            }
        }
    }
    return null;
}

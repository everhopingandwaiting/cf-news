import { Bindings } from '../types';

// ========== 配置管理 ==========

export async function getConfig(env: Bindings, key: string): Promise<string | null> {
    try {
        const row = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?').bind(key).first<{ value: string }>();
        return row?.value || null;
    } catch {}
    return null;
}

export async function getConfigInt(env: Bindings, key: string, def: number): Promise<number> {
    const v = await getConfig(env, key);
    return v ? parseInt(v) : def;
}

// ========== Provider 查询 ==========

export async function getProviderOrder(env: Bindings): Promise<string[]> {
    const order = await getConfig(env, 'provider_order');
    return order ? order.split(',').map(s => s.trim()) : ['groq', 'cloudflare', 'openrouter', 'nvidia', 'mango'];
}

export async function getModels(env: Bindings, provider: string): Promise<string[]> {
    try {
        const rows = await env.DB.prepare(
            'SELECT model_id FROM provider_models WHERE provider = ? AND enabled = 1 ORDER BY score DESC'
        ).bind(provider).all<{ model_id: string }>();
        return rows.results.map(r => r.model_id);
    } catch (e) {
        console.error(`getModels error for ${provider}:`, e);
        return [];
    }
}

export async function getProviderInfo(env: Bindings, name: string): Promise<{ base_url: string; api_key: string } | null> {
    try {
        const row = await env.DB.prepare(
            'SELECT base_url, api_key_env, expires_at FROM providers WHERE name = ? AND enabled = 1'
        ).bind(name).first<{ base_url: string; api_key_env: string | null; expires_at: string | null }>();
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

// ========== 失败模型追踪 ==========

export async function getFailed(env: Bindings): Promise<string[]> {
    try {
        const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ai_failed_models'").first<{ value: string }>();
        if (!row) return [];
        const data = JSON.parse(row.value);
        if (Array.isArray(data)) return [];
        if (!data.models || typeof data.models !== 'object') return [];
        const now = Math.floor(Date.now() / 1000);
        const ttl = await getConfigInt(env, '', 900);
        return Object.entries(data.models)
            .filter(([, ts]) => now - (ts as number) < ttl)
            .map(([model]) => model);
    } catch { return []; }
}

export async function markFailed(env: Bindings, model: string, _provider: string): Promise<void> {
    const now = Math.floor(Date.now() / 1000);
    const row = await env.DB.prepare("SELECT value FROM app_config WHERE key = 'ai_failed_models'").first<{ value: string }>();
    const models: Record<string, number> = {};
    if (row) {
        const data = JSON.parse(row.value);
        if (data.models && typeof data.models === 'object') {
            Object.assign(models, data.models);
        }
    }
    const ttl = await getConfigInt(env, '', 900);
    for (const [m, ts] of Object.entries(models)) {
        if (now - ts >= ttl) delete models[m];
    }
    if (!models[model]) {
        models[model] = now;
        await env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('ai_failed_models', ?)")
            .bind(JSON.stringify({ models })).run();
    }
}

// ========== 日志 ==========

export async function logAICall(env: Bindings, data: {
    provider: string; model?: string; news_id?: number; news_title?: string;
    prompt_length: number; response_length: number; response_preview?: string;
    duration_ms: number; success: boolean; error?: string;
}) {
    try {
        await env.DB.prepare(
            `INSERT INTO ai_call_log (provider, model, news_id, news_title, prompt_length, response_length, response_preview, duration_ms, success, error)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(data.provider, data.model || null, data.news_id || null, data.news_title || null,
            data.prompt_length, data.response_length, data.response_preview?.substring(0, 200) || null,
            data.duration_ms, data.success ? 1 : 0, data.error || null).run();
    } catch (e) { console.error('Log insert error:', e); }
}

// ========== 调用器 ==========

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
            console.error(`${provider}/${model} error ${res.status}: ${errText}`);
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
        await markFailed(env, model, provider);
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
        await markFailed(env, model, 'cloudflare');
        return null;
    }
}

// ========== 统一调用 ==========

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

    for (const provider of order) {
        if (provider === 'cloudflare') {
            const models = await getModels(env, 'cloudflare');
            for (const model of models) {
                const result = await doCF(env, model, messages, options);
                if (result) return result;
            }
        } else {
            const info = await getProviderInfo(env, provider);
            if (!info) continue;
            const models = await getModels(env, provider);
            for (const model of models) {
                const result = await doOpenAICompat(env, provider, info.base_url, info.api_key, model, messages, options);
                if (result) return result;
            }
        }
    }
    return null;
}

// ========== Streaming ==========

async function doOpenAICompatStream(
    env: Bindings, provider: string, baseUrl: string, apiKey: string,
    model: string, messages: { role: string; content: string }[],
    options?: { max_tokens?: number; temperature?: number }
): Promise<ReadableStream | null> {
    const maxTokens = options?.max_tokens ?? (await getConfigInt(env, 'summary_max_tokens', 300));
    const temp = options?.temperature ?? parseFloat(await getConfig(env, 'summary_temperature') || '0.3');
    try {
        const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: temp, stream: true }),
            signal: AbortSignal.timeout(30000),
        });
        if (!res.ok || !res.body) {
            const errText = await res.text().catch(() => '');
            console.error(`${provider}/${model} stream error ${res.status}: ${errText}`);
            await markFailed(env, model, provider);
            return null;
        }
        // Wrap in a new ReadableStream to ensure proper streaming behavior in Workers
        const reader = res.body.getReader();
        const encoder = new TextEncoder();
        return new ReadableStream({
            async pull(controller) {
                try {
                    const { done, value } = await reader.read();
                    if (done) { controller.close(); return; }
                    controller.enqueue(value);
                } catch (e) {
                    console.error(`${provider}/${model} stream read error:`, e);
                    controller.close();
                }
            },
            cancel() { reader.cancel().catch(() => {}); },
        });
    } catch (e: any) {
        console.error(`${provider}/${model} stream exception:`, e);
        await markFailed(env, model, provider);
        return null;
    }
}

async function doCFStream(
    env: Bindings, model: string, messages: { role: string; content: string }[],
    options?: { max_tokens?: number; temperature?: number }
): Promise<ReadableStream | null> {
    const maxTokens = options?.max_tokens ?? (await getConfigInt(env, 'summary_max_tokens', 300));
    const temp = options?.temperature ?? parseFloat(await getConfig(env, 'summary_temperature') || '0.3');
    try {
        const stream = await env.AI.run(model, { messages, max_tokens: maxTokens, temperature: temp, stream: true }) as ReadableStream;
        if (!stream) return null;
        // Convert Workers AI streaming format to OpenAI SSE
        const decoder = new TextDecoder();
        const encoder = new TextEncoder();
        return new ReadableStream({
            async start(controller) {
                const reader = stream.getReader();
                try {
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const text = decoder.decode(value, { stream: true });
                        try {
                            const json = JSON.parse(text);
                            const content = json.response || '';
                            if (content) {
                                const sse = `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
                                controller.enqueue(encoder.encode(sse));
                            }
                        } catch { /* skip malformed chunks */ }
                    }
                    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
                } finally {
                    reader.releaseLock();
                }
                controller.close();
            }
        });
    } catch (e: any) {
        console.error(`cloudflare/${model} stream exception:`, e);
        await markFailed(env, model, 'cloudflare');
        return null;
    }
}

export async function callAIStream(
    env: Bindings, prompt: string, options?: AIOptions
): Promise<ReadableStream | null> {
    const messages = options?.system_prompt
        ? [{ role: 'system', content: options.system_prompt }, { role: 'user', content: prompt }]
        : [{ role: 'user', content: prompt }];

    const order = await getProviderOrder(env);

    for (const provider of order) {
        if (provider === 'cloudflare') {
            const models = await getModels(env, 'cloudflare');
            for (const model of models) {
                const result = await doCFStream(env, model, messages, options);
                if (result) return result;
            }
        } else {
            const info = await getProviderInfo(env, provider);
            if (!info) continue;
            const models = await getModels(env, provider);
            for (const model of models) {
                const result = await doOpenAICompatStream(env, provider, info.base_url, info.api_key, model, messages, options);
                if (result) return result;
            }
        }
    }
    return null;
}

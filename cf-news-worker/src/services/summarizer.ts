import { Bindings } from '../types';

// ========== 通用工具 ==========

function cleanText(text: string): string {
    return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

async function logAICall(env: Bindings, data: {
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

// ========== 配置管理 ==========

const CFG_CACHE_PREFIX = 'cfg_';

async function getConfig(env: Bindings, key: string): Promise<string | null> {
    const cached = await env.KV.get(CFG_CACHE_PREFIX + key);
    if (cached) return cached;
    try {
        const row = await env.DB.prepare('SELECT value FROM app_config WHERE key = ?').bind(key).first<{ value: string }>();
        if (row) { env.KV.put(CFG_CACHE_PREFIX + key, row.value, { expirationTtl: 300 }).catch(() => {}); return row.value; }
    } catch {}
    return null;
}

async function getConfigInt(env: Bindings, key: string, def: number): Promise<number> {
    const v = await getConfig(env, key);
    return v ? parseInt(v) : def;
}

async function getModels(env: Bindings, provider: string): Promise<string[]> {
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

// 读取 provider 配置（含过期时间检查）
async function getProviderInfo(env: Bindings, name: string): Promise<{ base_url: string; api_key: string } | null> {
    try {
        const row = await env.DB.prepare(
            'SELECT base_url, api_key_env, expires_at FROM providers WHERE name = ? AND enabled = 1'
        ).bind(name).first<{ base_url: string; api_key_env: string | null; expires_at: string | null }>();
        if (!row) return null;

        // 检查过期
        if (row.expires_at && new Date(row.expires_at) < new Date()) {
            console.log(`Provider ${name} expired at ${row.expires_at}`);
            return null;
        }

        // 读取 API key（优先从 env 变量读取）
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

async function getProviderOrder(env: Bindings): Promise<string[]> {
    const order = await getConfig(env, 'provider_order');
    return order ? order.split(',').map(s => s.trim()) : ['mango', 'nvidia', 'openrouter', 'cloudflare'];
}

// ========== 失败模型追踪 ==========

async function getFailed(env: Bindings): Promise<string[]> {
    try {
        const raw = await env.KV.get('ai_failed_models');
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

async function markFailed(env: Bindings, model: string, provider: string): Promise<void> {
    const ttlKey = provider + '_failed_ttl';
    const ttl = await getConfigInt(env, ttlKey, 300);
    const failed = await getFailed(env);
    if (!failed.includes(model)) {
        failed.push(model);
        env.KV.put('ai_failed_models', JSON.stringify(failed), { expirationTtl: ttl }).catch(() => {});
    }
}

async function tryModels(
    env: Bindings, models: string[], provider: string,
    caller: (env: Bindings, model: string, prompt: string, newsId?: number, newsTitle?: string) => Promise<string | null>,
    prompt: string, newsId?: number, newsTitle?: string
): Promise<string | null> {
    const failed = await getFailed(env);
    for (const model of models) {
        if (failed.includes(model)) continue;
        const result = await caller(env, model, prompt, newsId, newsTitle);
        if (result) return result;
    }
    return null;
}

// ========== Provider 调用器 ==========

async function doOpenAICompat(
    env: Bindings, provider: string, baseUrl: string, apiKey: string,
    model: string, prompt: string, newsId?: number, newsTitle?: string
): Promise<string | null> {
    const start = Date.now();
    const maxTokens = await getConfigInt(env, 'summary_max_tokens', 180);
    const temp = parseFloat(await getConfig(env, 'summary_temperature') || '0.3');
    try {
        const url = baseUrl.endsWith('/') ? `${baseUrl}chat/completions` : `${baseUrl}/chat/completions`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, temperature: temp }),
            signal: AbortSignal.timeout(120000),
        });
        if (!res.ok) {
            const errText = await res.text().catch(() => '');
            console.error(`${provider}/${model} error ${res.status}: ${errText}`);
            await markFailed(env, model, provider);
            return null;
        }
        const body: any = await res.json();
        const text = body?.choices?.[0]?.message?.content || '';
        await logAICall(env, { provider, model, news_id: newsId, news_title: newsTitle,
            prompt_length: prompt.length, response_length: text.length, response_preview: text,
            duration_ms: Date.now() - start, success: !!text });
        if (!text) await markFailed(env, model, provider);
        return text || null;
    } catch (e: any) {
        await logAICall(env, { provider, model, news_id: newsId, news_title: newsTitle,
            prompt_length: prompt.length, response_length: 0, duration_ms: Date.now() - start, success: false, error: String(e) });
        await markFailed(env, model, provider);
        return null;
    }
}

async function doCF(env: Bindings, model: string, prompt: string, newsId?: number, newsTitle?: string): Promise<string | null> {
    const start = Date.now();
    const maxTokens = await getConfigInt(env, 'summary_max_tokens', 180);
    const temp = parseFloat(await getConfig(env, 'summary_temperature') || '0.3');
    try {
        const r: any = await env.AI.run(model, { prompt, max_tokens: maxTokens, temperature: temp });
        const text = r?.response || r?.output || '';
        await logAICall(env, { provider: 'cloudflare', model, news_id: newsId, news_title: newsTitle,
            prompt_length: prompt.length, response_length: text.length, response_preview: text,
            duration_ms: Date.now() - start, success: !!text });
        if (!text) await markFailed(env, model, 'cloudflare');
        return text || null;
    } catch (e: any) {
        await logAICall(env, { provider: 'cloudflare', model, news_id: newsId, news_title: newsTitle,
            prompt_length: prompt.length, response_length: 0, duration_ms: Date.now() - start, success: false, error: String(e) });
        await markFailed(env, model, 'cloudflare');
        return null;
    }
}

// ========== Provider 路由 ==========

const PROVIDER_MAP: Record<string, (env: Bindings, model: string, prompt: string, newsId?: number, newsTitle?: string) => Promise<string | null>> = {
    cloudflare: doCF,
    nvidia: doCF,    // will be overridden below
    openrouter: doCF, // will be overridden below
    mango: doCF,      // will be overridden below
};

// Override OpenAI-compatible providers
async function doGeneric(env: Bindings, provider: string, model: string, prompt: string, newsId?: number, newsTitle?: string): Promise<string | null> {
    const info = await getProviderInfo(env, provider);
    if (!info) return null;
    return doOpenAICompat(env, provider, info.base_url, info.api_key, model, prompt, newsId, newsTitle);
}

// ========== 主入口 ==========

export async function generateSummary(env: Bindings, item: { id?: number; title: string; description?: string; content?: string }): Promise<string | null> {
    const text = cleanText(item.content || item.description || '');
    const input = text.length > 1500 ? text.substring(0, 1500) : text;
    const combined = `${item.title}. ${input}`;
    if (combined.length < 60) return null;

    const tmpl = await getConfig(env, 'prompt_template') || 'Please summarize the following news in 2 concise Chinese sentences. ONLY output Chinese, no English. Focus on key information.\n\n{{TEXT}}\n\nChinese summary:';
    const prompt = tmpl.replace('{{TEXT}}', combined);

    const order = await getProviderOrder(env);

    for (const provider of order) {
        // 检查 provider 是否已过期
        if (provider !== 'cloudflare') {
            const info = await getProviderInfo(env, provider);
            if (!info) continue;
        }

        const models = await getModels(env, provider);
        if (models.length === 0) continue;

        let caller = PROVIDER_MAP[provider];
        if (!caller) continue;

        // OpenAI-compatible providers use generic caller
        if (provider !== 'cloudflare') {
            const p = provider;
            caller = (env, model, prompt, newsId, newsTitle) => doGeneric(env, p, model, prompt, newsId, newsTitle);
        }

        const result = await tryModels(env, models, provider, caller, prompt, item.id, item.title);
        if (result) return result?.trim() || null;
    }
    return null;
}

export async function generateSummaryForNews(env: Bindings, newsId: number, item: { title: string; description?: string; content?: string }): Promise<boolean> {
    const summary = await generateSummary(env, { ...item, id: newsId });
    if (!summary || summary.length < 10) return false;
    await env.DB.prepare('INSERT OR REPLACE INTO news_summaries (news_id, summary) VALUES (?, ?)').bind(newsId, summary.substring(0, 500)).run();

    // 顺便生成 AI 小编吐槽
    generateAITake(env, newsId, item).catch(() => {}); // no waitUntil here, run in same context

    return true;
}

// ========== AI 小编吐槽 ==========
const TAKE_PROMPT = '你是一个毒舌但有趣的新闻评论员。用一句中文吐槽这篇新闻，幽默犀利，一针见血，不超过40字。不要用表情符号。\n\n新闻标题：{{TITLE}}\n\n吐槽：';

export async function generateAITake(env: Bindings, newsId: number, item: { title: string; description?: string; content?: string }): Promise<void> {
    const existing = await env.DB.prepare('SELECT take FROM news_ai_take WHERE news_id = ?').bind(newsId).first();
    if (existing) return;

    const prompt = TAKE_PROMPT.replace('{{TITLE}}', item.title || '');
    const info = await getProviderInfo(env, 'mango');
    if (!info) return;
    const models = await getModels(env, 'mango');
    if (models.length === 0) return;

    for (const model of models) {
        const text = await doOpenAICompat(env, 'mango', info.base_url, info.api_key, model, prompt);
        if (text && text.length > 3 && text.length < 200) {
            await env.DB.prepare('INSERT OR REPLACE INTO news_ai_take (news_id, take) VALUES (?, ?)').bind(newsId, text).run();
            return;
        }
    }
}
// ========== 多视角对比 ==========
const PERSPECTIVE_PROMPT = '以下是多篇媒体报道同一新闻事件的标题和摘要。请分析不同媒体的报道角度差异，用中文给出对比观点，200字以内。\n\n{{ARTICLES}}\n\n多视角分析：';

export async function generatePerspectives(env: Bindings, newsId: number): Promise<{ related: { id: number; source: string; title: string }[]; perspective: string } | null> {
    // 先查缓存
    const cached = await env.DB.prepare('SELECT related_ids, perspective FROM news_perspectives WHERE news_id = ?').bind(newsId).first<{ related_ids: string; perspective: string }>();
    if (cached) {
        const ids = cached.related_ids.split(',').map(Number);
        const rows = await env.DB.prepare(`SELECT n.id, s.name as source_name, n.title FROM news_items n LEFT JOIN news_sources s ON n.source_id = s.id WHERE n.id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: number; source_name: string; title: string }>();
        return { related: rows.results.map(r => ({ id: r.id, source: r.source_name, title: r.title })), perspective: cached.perspective };
    }

    if (!env.VECTORIZE) return null;

    // 从 D1 查询当前新闻标题
    const item = await env.DB.prepare('SELECT title, description FROM news_items WHERE id = ? AND is_deleted = 0').bind(newsId).first<{ title: string; description: string | null }>();
    if (!item) return null;

    const text = `${item.title} ${item.description || ''}`;
    if (text.length < 20) return null;

    try {
        const embedding = await env.AI.run('@cf/qwen/qwen3-embedding-0.6b', { text: [text] });
        const vector = embedding.data[0];
        if (!vector) return null;

        const matches = await env.VECTORIZE.query(vector, { topK: 6, returnMetadata: false });
        if (matches.count < 2) return null;

        const ids = matches.matches.map((m: any) => parseInt(m.id)).filter((id: number) => id !== newsId).slice(0, 3);
        if (ids.length === 0) return null;

        const rows = await env.DB.prepare(`SELECT n.id, s.name as source_name, n.title, n.description FROM news_items n LEFT JOIN news_sources s ON n.source_id = s.id WHERE n.id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<{ id: number; source_name: string; title: string; description: string | null }>();
        if (rows.results.length === 0) return null;

        const articles = rows.results.map((r, i) => `【来源${i + 1}】${r.source_name || '未知'}\n标题：${r.title}\n摘要：${(r.description || '').substring(0, 200)}`).join('\n\n');
        const prompt = PERSPECTIVE_PROMPT.replace('{{ARTICLES}}', articles);

        // 用芒果/NVIDIA 生成多视角分析
        const order = await getProviderOrder(env);
        let perspective = '';
        for (const provider of order) {
            if (provider !== 'cloudflare') {
                const info = await getProviderInfo(env, provider);
                if (!info) continue;
            }
            const models = await getModels(env, provider);
            if (models.length === 0) continue;

            let caller: any;
            if (provider !== 'cloudflare') {
                const p = provider;
                caller = (e: any, m: string, p2: string) => doGeneric(e, p, m, p2);
            } else {
                caller = doCF;
            }

            for (const model of models) {
                const result = await caller(env, model, prompt);
                if (result && result.length > 20) {
                    perspective = result;
                    break;
                }
            }
            if (perspective) break;
        }

        if (!perspective) return null;

        // 缓存结果
        const relatedIds = rows.results.map(r => r.id).join(',');
        await env.DB.prepare('INSERT OR REPLACE INTO news_perspectives (news_id, related_ids, perspective) VALUES (?, ?, ?)').bind(newsId, relatedIds, perspective.substring(0, 500)).run();

        return {
            related: rows.results.map(r => ({ id: r.id, source: r.source_name, title: r.title })),
            perspective,
        };
    } catch (e) {
        console.error('generatePerspectives error:', e);
        return null;
    }
}

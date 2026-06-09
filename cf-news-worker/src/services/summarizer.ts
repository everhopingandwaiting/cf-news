import { Bindings } from '../types';
import { getConfig, getConfigInt, getModels, getProviderInfo, getProviderOrder, getFailed, callAI, doOpenAICompat as aiDoOpenAICompat, doCF as aiDoCF } from './aiProvider';
import { fetchRichArticleContent } from './contentFetcher';
import { eq, and, sql, isNull } from 'drizzle-orm';
import { getDb } from '../db';
import { newsSummaries, newsAiTake, newsPerspectives, newsItems, newsSources } from '../db/schema';

function cleanText(text: string): string {
    return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
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

async function doOpenAICompat(
    env: Bindings, provider: string, baseUrl: string, apiKey: string,
    model: string, prompt: string, newsId?: number, newsTitle?: string
): Promise<string | null> {
    const maxTokens = await getConfigInt(env, 'summary_max_tokens', 180);
    const temp = parseFloat(await getConfig(env, 'summary_temperature') || '0.3');
    return aiDoOpenAICompat(env, provider, baseUrl, apiKey, model,
        [{ role: 'user', content: prompt }],
        { max_tokens: maxTokens, temperature: temp, news_id: newsId, news_title: newsTitle }
    );
}

async function doCF(env: Bindings, model: string, prompt: string, newsId?: number, newsTitle?: string): Promise<string | null> {
    const maxTokens = await getConfigInt(env, 'summary_max_tokens', 180);
    const temp = parseFloat(await getConfig(env, 'summary_temperature') || '0.3');
    return aiDoCF(env, model, [{ role: 'user', content: prompt }],
        { max_tokens: maxTokens, temperature: temp, news_id: newsId, news_title: newsTitle }
    );
}

const PROVIDER_MAP: Record<string, (env: Bindings, model: string, prompt: string, newsId?: number, newsTitle?: string) => Promise<string | null>> = {
    cloudflare: doCF,
    nvidia: doCF,
    openrouter: doCF,
    mango: doCF,
};

async function doGeneric(env: Bindings, provider: string, model: string, prompt: string, newsId?: number, newsTitle?: string): Promise<string | null> {
    const info = await getProviderInfo(env, provider);
    if (!info) return null;
    return doOpenAICompat(env, provider, info.base_url, info.api_key, model, prompt, newsId, newsTitle);
}

export async function generateSummary(env: Bindings, item: { id?: number; title: string; description?: string; content?: string }): Promise<string | null> {
    const text = cleanText(item.content || item.description || '');
    const input = text.length > 1500 ? text.substring(0, 1500) : text;
    const combined = `${item.title}. ${input}`;
    if (combined.length < 60) return null;

    const tmpl = await getConfig(env, 'prompt_template') || 'Summarize the news below in 2 concise Chinese sentences. Output ONLY the 2 sentences — no labels, no notes, no English.\n\n{{TEXT}}';
    const prompt = tmpl.replace('{{TEXT}}', combined);

    const order = await getProviderOrder(env);

    for (const provider of order) {
        if (provider !== 'cloudflare') {
            const info = await getProviderInfo(env, provider);
            if (!info) continue;
        }

        const models = await getModels(env, provider);
        if (models.length === 0) continue;

        let caller = PROVIDER_MAP[provider];

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
    const db = getDb(env);
    // Use raw SQL for INSERT OR REPLACE (Drizzle doesn't have a direct "or replace" for sqlite)
    await db.run(sql`INSERT OR REPLACE INTO news_summaries (news_id, summary) VALUES (${newsId}, ${summary.substring(0, 500)})`);

    generateAITake(env, newsId, item).catch(() => {});

    return true;
}

const SUMMARY_BATCH_SIZE = 10;

export async function generateBatchSummariesForNews(
    env: Bindings,
    items: { id: number; title: string; description?: string; content?: string }[]
): Promise<number> {
    if (items.length === 0) return 0;
    let successCount = 0;
    for (let i = 0; i < items.length; i += SUMMARY_BATCH_SIZE) {
        const batch = items.slice(i, i + SUMMARY_BATCH_SIZE);
        successCount += await generateOneBatch(env, batch);
    }
    return successCount;
}

async function generateOneBatch(
    env: Bindings,
    items: { id: number; title: string; description?: string; content?: string }[]
): Promise<number> {
    const articles: { text: string; tooShort: boolean }[] = items.map(item => {
        const text = cleanText(item.content || item.description || '');
        const input = text.length > 1500 ? text.substring(0, 1500) : text;
        return { text: `${item.title}. ${input}`, tooShort: (`${item.title}. ${input}`).length < 60 };
    });

    if (articles.some(a => a.tooShort)) {
        let count = 0;
        for (let i = 0; i < items.length; i++) {
            if (!articles[i].tooShort) {
                if (await generateSummaryForNews(env, items[i].id, items[i])) count++;
            }
        }
        return count;
    }

    const blocks = articles.map((a, i) =>
        `Article ${i + 1}:\nTitle: ${items[i].title}\nContent: ${a.text}`
    ).join('\n\n');

    const batchPrompt = `For each article below, write a 2-sentence Chinese summary. Output ONLY a JSON array — no labels, no notes, no English.

${blocks}

Return: [{"summary":"<article1 summary>"},{"summary":"<article2 summary>"},...]`;

    const result = await callAI(env, batchPrompt, {
        max_tokens: items.length * 120,
        temperature: 0.3,
    });

    if (result) {
        const summaries = parseBatchResult(result, items.length);
        if (summaries) {
            const db = getDb(env);
            let count = 0;
            for (let i = 0; i < items.length; i++) {
                if (summaries[i]) {
                    await db.run(sql`INSERT OR REPLACE INTO news_summaries (news_id, summary) VALUES (${items[i].id}, ${summaries[i]!.substring(0, 500)})`);
                    generateAITake(env, items[i].id, items[i]).catch(() => {});
                    count++;
                }
            }
            return count;
        }
    }

    let count = 0;
    for (const item of items) {
        if (await generateSummaryForNews(env, item.id, item)) count++;
    }
    return count;
}

function parseBatchResult(text: string, expectedCount: number): (string | null)[] | null {
    try {
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) return null;
        const parsed = JSON.parse(jsonMatch[0]);
        if (!Array.isArray(parsed)) return null;
        if (parsed.length < expectedCount) return null;
        return parsed.slice(0, expectedCount).map((item: any) => {
            const s = item?.summary;
            return (s && typeof s === 'string' && s.length >= 10) ? s.trim() : null;
        });
    } catch {
        return null;
    }
}

const TAKE_PROMPT = '你是一个毒舌但有趣的新闻评论员。用一句中文吐槽这篇新闻，幽默犀利，一针见血，不超过40字。不要用表情符号。\n\n新闻标题：{{TITLE}}\n\n吐槽：';

export async function generateAITake(env: Bindings, newsId: number, item: { title: string; description?: string; content?: string }): Promise<void> {
    const db = getDb(env);
    const existing = await db.select({ take: newsAiTake.take })
        .from(newsAiTake)
        .where(eq(newsAiTake.news_id, newsId))
        .get();
    if (existing) return;

    const prompt = TAKE_PROMPT.replace('{{TITLE}}', item.title || '');
    const order = await getProviderOrder(env);

    for (const provider of order) {
        if (provider !== 'cloudflare') {
            const info = await getProviderInfo(env, provider);
            if (!info) continue;
        }
        const models = await getModels(env, provider);
        if (models.length === 0) continue;

        for (const model of models) {
            let text: string | null = null;
            if (provider === 'cloudflare') {
                text = await doCF(env, model, prompt);
            } else {
                const info = await getProviderInfo(env, provider);
                if (!info) continue;
                text = await doOpenAICompat(env, provider, info.base_url, info.api_key, model, prompt);
            }
            if (text && text.length > 3 && text.length < 200) {
                await db.run(sql`INSERT OR REPLACE INTO news_ai_take (news_id, take) VALUES (${newsId}, ${text})`);
                return;
            }
        }
    }
}

const PERSPECTIVE_PROMPT = '以下是多篇媒体报道同一新闻事件的标题和摘要。请分析不同媒体的报道角度差异，用中文给出对比观点，200字以内。\n\n{{ARTICLES}}\n\n多视角分析：';

export async function generatePerspectives(env: Bindings, newsId: number): Promise<{ related: { id: number; source: string; title: string }[]; perspective: string } | null> {
    const db = getDb(env);
    const cached = await db.select({
        relatedIds: newsPerspectives.related_ids,
        perspective: newsPerspectives.perspective,
    }).from(newsPerspectives)
        .where(eq(newsPerspectives.news_id, newsId))
        .get();

    if (cached) {
        const ids = cached.related_ids.split(',').map(Number);
        const rows = await db.all<{ id: number; source_name: string; title: string }>(sql`
            SELECT n.id, s.name as source_name, n.title
            FROM news_items n LEFT JOIN news_sources s ON n.source_id = s.id
            WHERE n.id IN (${ids.join(',')})
        `);
        return { related: rows.map(r => ({ id: r.id, source: r.source_name, title: r.title })), perspective: cached.perspective };
    }

    if (!env.VECTORIZE) return null;

    const item = await db.select({
        title: newsItems.title, description: newsItems.description,
    }).from(newsItems)
        .where(and(eq(newsItems.id, newsId), eq(newsItems.is_deleted, 0)))
        .get();

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

        const rows = await db.all<{ id: number; source_name: string; title: string; description: string | null }>(sql`
            SELECT n.id, s.name as source_name, n.title, n.description
            FROM news_items n LEFT JOIN news_sources s ON n.source_id = s.id
            WHERE n.id IN (${ids.join(',')})
        `);
        if (rows.length === 0) return null;

        const articles = rows.map((r, i) => `【来源${i + 1}】${r.source_name || '未知'}\n标题：${r.title}\n摘要：${(r.description || '').substring(0, 200)}`).join('\n\n');
        const prompt = PERSPECTIVE_PROMPT.replace('{{ARTICLES}}', articles);

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

        const relatedIds = rows.map(r => r.id).join(',');
        await db.run(sql`INSERT OR REPLACE INTO news_perspectives (news_id, related_ids, perspective) VALUES (${newsId}, ${relatedIds}, ${perspective.substring(0, 500)})`);

        return {
            related: rows.map(r => ({ id: r.id, source: r.source_name, title: r.title })),
            perspective,
        };
    } catch (e) {
        console.error('generatePerspectives error:', e);
        return null;
    }
}

export async function generatePendingSummaries(env: Bindings): Promise<void> {
    console.log('Generating pending AI summaries...');
    const db = getDb(env);

    const shortItems = await db.all<{ id: number; title: string; url: string }>(sql`
        SELECT id, title, url FROM news_items 
        WHERE LENGTH(COALESCE(content,'')) < 300 AND LENGTH(COALESCE(description,'')) < 300
        AND url IS NOT NULL LIMIT 5
    `);
    for (const item of shortItems) {
        try {
            const rich = await fetchRichArticleContent(item.url);
            if (rich) {
                await db.update(newsItems)
                    .set({ content: rich.html, description: rich.text })
                    .where(eq(newsItems.id, item.id));
                console.log(`Enriched: "${item.title.substring(0, 40)}"`);
            }
        } catch (e) {
            console.error(`Enrich failed for "${item.title}":`, e);
        }
    }

    const items = await db.all<{ id: number; title: string; description: string | null; content: string | null }>(sql`
        SELECT n.id, n.title, n.description, n.content 
        FROM news_items n LEFT JOIN news_summaries ns ON ns.news_id = n.id 
        WHERE ns.id IS NULL AND (n.description IS NOT NULL OR n.content IS NOT NULL)
        LIMIT 10
    `);

    if (items.length === 0) {
        console.log('No pending summaries');
        return;
    }

    console.log(`Found ${items.length} items without summaries`);
    const done = await generateBatchSummariesForNews(env, items as any);
    console.log(`Summary generation complete: ${done}/${items.length}`);
}

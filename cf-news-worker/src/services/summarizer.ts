import { Bindings, NewsQueueMessage } from '../types';
import { getConfig, getConfigInt, getAvailableModels, getAvailableModelSpecs, getProviderInfo, getProviderOrder, callAI, doOpenAICompat as aiDoOpenAICompat, doCF as aiDoCF } from './aiProvider';
import { fetchRichArticleContent } from './contentFetcher';
import { eq, and, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { newsSummaries, newsAiTake, newsPerspectives, newsItems } from '../db/schema';

function cleanText(text: string): string {
    return text.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

async function tryModels(
    env: Bindings, models: string[],
    caller: (env: Bindings, model: string, prompt: string, newsId?: number, newsTitle?: string) => Promise<string | null>,
    prompt: string, newsId?: number, newsTitle?: string
): Promise<string | null> {
    for (const model of models) {
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
    const maxModels = await getMaxModelsPerProvider(env);

    for (const provider of order) {
        if (provider !== 'cloudflare') {
            const info = await getProviderInfo(env, provider);
            if (!info) continue;
        }

        const models = await getAvailableModels(env, provider, maxModels);
        if (models.length === 0) continue;

        let caller = PROVIDER_MAP[provider];

        if (provider !== 'cloudflare') {
            const p = provider;
            caller = (env, model, prompt, newsId, newsTitle) => doGeneric(env, p, model, prompt, newsId, newsTitle);
        }

        const result = await tryModels(env, models, caller, prompt, item.id, item.title);
        if (result) return result?.trim() || null;
    }
    return null;
}

// 摘要成功后不再在同一 invocation 内 fire-and-forget 生成毒舌点评/实体抽取：
// 每条都会遍历整条 provider 链，逐条调用会把 summary cron 单次 invocation 的
// 50-external-subrequest 预算烧爆（超出后连 D1 写入都会失败）。
// 改为入队独立消息，每条在独立 invocation（独立预算）中执行。
function enqueueTakeAndEntities(env: Bindings, newsId: number, item: { title: string; description?: string; content?: string }): void {
    const takeMsg: NewsQueueMessage = { type: 'generate_take', newsId, title: item.title, description: item.description, content: item.content };
    const entitiesMsg: NewsQueueMessage = { type: 'generate_entities', newsId, title: item.title, description: item.description, content: item.content };
    env.NEWS_QUEUE.send(takeMsg).catch(() => {});
    env.NEWS_QUEUE.send(entitiesMsg).catch(() => {});
}

export async function generateSummaryForNews(env: Bindings, newsId: number, item: { title: string; description?: string; content?: string }): Promise<boolean> {
    const summary = await generateSummary(env, { ...item, id: newsId });
    if (!summary || summary.length < 10) return false;
    const db = getDb(env);
    const existing = await db.select({ id: newsSummaries.id })
        .from(newsSummaries)
        .where(eq(newsSummaries.news_id, newsId))
        .get();
    if (existing) {
        await db.update(newsSummaries)
            .set({ summary: summary.substring(0, 500) })
            .where(eq(newsSummaries.news_id, newsId));
    } else {
        await db.insert(newsSummaries)
            .values({ news_id: newsId, summary: summary.substring(0, 500) });
    }

    enqueueTakeAndEntities(env, newsId, item);

    return true;
}

// 批量摘要大小不再固定：按 provider 链上实际可用的模型能力（context_size /
// max_output）动态计算。分两层：
//   small — 任何模型都能处理的安全批量（按全链最小能力）
//   large — 只有大 context / 大 max_output 的模型（如 zen 1M）能处理，
//           输出上限充足时一次塞入更多文章，减少请求次数对抗限流。
const DEFAULT_BATCH_SIZE = 10;
const SMALL_BATCH_MAX = 20;   // 小批量上限：nvidia 4K 输出模型也能可靠解析
const LARGE_BATCH_MAX = 40;   // 大批量上限：zen 1M 模型可容纳；60+ 数组模型漏条概率高，40 已翻倍于旧上限
const LARGE_MIN_OUTPUT = 4800; // = LARGE_BATCH_MAX × 120：只有输出预算能服务整个大 batch 的模型才配 large，
                               // 否则大 batch 会输出截断 → JSON 解析失败 → 白走一遍 provider 链
const TOKENS_PER_ARTICLE = 1100; // ~1500 字符输入（中英混合保守估计）+ prompt 模板 + 每篇输出预算

export interface BatchSizes { large: number; small: number }

export async function getBatchSizes(env: Bindings): Promise<BatchSizes> {
    const order = await getProviderOrder(env);
    const specs: { context_size: number; max_output: number }[] = [];
    for (const provider of order) {
        specs.push(...(await getAvailableModelSpecs(env, provider, 3)));
    }
    if (specs.length === 0) return { large: DEFAULT_BATCH_SIZE, small: DEFAULT_BATCH_SIZE };

    // small 按全链最弱可用模型计算，保证任何模型都能处理
    const minContext = Math.min(...specs.map(s => s.context_size));
    const minOutput = Math.min(...specs.map(s => s.max_output));
    const byContext = (ctx: number) => Math.max(1, Math.floor((ctx * 0.6) / TOKENS_PER_ARTICLE));
    const byOutput = (out: number) => Math.max(1, Math.floor(out / 120));
    const small = Math.max(1, Math.min(byContext(minContext), byOutput(minOutput), SMALL_BATCH_MAX));

    // large 只从 max_output ≥ LARGE_MIN_OUTPUT 的模型计算。zen 被限流/标记失败后
    // 没有任何模型达标 → large 塌缩为 small，跳过会白烧外部 subrequest 的 large 尝试
    //（Worker 免费版外部 subrequest 仅 50/次，大 batch 失败后还要走小 batch 回退）。
    let large = small;
    for (const spec of specs) {
        if (spec.max_output >= LARGE_MIN_OUTPUT) {
            const candidate = Math.min(byContext(spec.context_size), byOutput(spec.max_output), LARGE_BATCH_MAX);
            if (candidate > large) large = candidate;
        }
    }
    return { large, small };
}

export async function getSummaryBatchSize(env: Bindings): Promise<number> {
    return (await getBatchSizes(env)).small;
}

async function getMaxModelsPerProvider(env: Bindings): Promise<number> {
    const configured = await getConfigInt(env, 'ai_max_models_per_provider', 2);
    return Math.min(Math.max(configured, 1), 5);
}

export async function generateBatchSummariesForNews(
    env: Bindings,
    items: { id: number; title: string; description?: string; content?: string }[]
): Promise<number> {
    if (items.length === 0) return 0;
    const { large, small } = await getBatchSizes(env);

    // 大批量优先：只让 max_output 充足的模型（zen 1M）参与，一次塞入尽可能多文章。
    // 若失败（限流/无合适模型），拆成小批量走全链回退，不浪费请求。
    if (large > small && items.length >= small) {
        let successCount = 0;
        for (let i = 0; i < items.length; i += large) {
            const batch = items.slice(i, i + large);
            const done = await generateOneBatch(env, batch, { minMaxOutput: batch.length * 120 });
            if (done > 0) {
                successCount += done;
            } else {
                for (let j = 0; j < batch.length; j += small) {
                    successCount += await generateOneBatch(env, batch.slice(j, j + small));
                }
            }
        }
        return successCount;
    }

    let successCount = 0;
    for (let i = 0; i < items.length; i += small) {
        const batch = items.slice(i, i + small);
        successCount += await generateOneBatch(env, batch);
    }
    return successCount;
}

async function generateOneBatch(
    env: Bindings,
    items: { id: number; title: string; description?: string; content?: string }[],
    opts?: { minMaxOutput?: number }
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
        // 大 batch 时只让 max_output 充足的模型（zen 1M）参与，防输出截断
        ...(opts?.minMaxOutput ? { min_max_output: opts.minMaxOutput } : {}),
    });

    if (result) {
        const summaries = parseBatchResult(result, items.length);
        if (summaries) {
            const db = getDb(env);
            let count = 0;
            for (let i = 0; i < items.length; i++) {
                if (summaries[i]) {
                    await db.run(sql`INSERT OR REPLACE INTO news_summaries (news_id, summary) VALUES (${items[i].id}, ${summaries[i]!.substring(0, 500)})`);
                    enqueueTakeAndEntities(env, items[i].id, items[i]);
                    count++;
                }
            }
            return count;
        }
    }

    // 大 batch 解析失败 → 返回 0，由调用方拆成小 batch 重试；
    // 直接在 40 篇文章上逐篇 fallback 会触发 Worker 50-subrequest 上限。
    if (opts?.minMaxOutput) return 0;

    // 小 batch 解析失败 → 最多逐篇兜底 5 篇（每篇会遍历整条 provider 链，
    // 超出 Worker 50-subrequest 上限后连 D1 写入都会失败），其余留到下一轮 cron。
    let count = 0;
    const fallbackLimit = Math.min(items.length, 5);
    for (let i = 0; i < fallbackLimit; i++) {
        if (await generateSummaryForNews(env, items[i].id, items[i])) count++;
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
        const maxModels = await getMaxModelsPerProvider(env);
        const models = await getAvailableModels(env, provider, maxModels);
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
                const existing = await db.select({ news_id: newsAiTake.news_id })
                    .from(newsAiTake)
                    .where(eq(newsAiTake.news_id, newsId))
                    .get();
                if (existing) {
                    await db.update(newsAiTake).set({ take: text }).where(eq(newsAiTake.news_id, newsId));
                } else {
                    await db.insert(newsAiTake).values({ news_id: newsId, take: text });
                }
                return;
            }
        }
    }
}

const PERSPECTIVE_PROMPT = '以下是多篇媒体报道同一新闻事件的标题和摘要。请分析不同媒体的报道角度差异，用中文给出对比观点，200字以内。\n\n{{ARTICLES}}\n\n多视角分析：';

// FTS5 keyword extraction shared with the related-articles fallback in routes/ai.ts.
// Splits the title into significant terms and builds an OR query so semantically
// related coverage (same event, different outlet) can be found without a
// vector index — VECTORIZE only holds dedup hashes, so it cannot serve this.
function stem(w: string): string {
    if (w.endsWith('ly')) w = w.slice(0, -2);
    if (w.endsWith('ing')) w = w.slice(0, -3);
    if (w.endsWith('ed')) w = w.slice(0, -2);
    return w;
}

async function buildPerspectiveFtsQuery(env: Bindings, title: string): Promise<string | null> {
    const db = getDb(env);
    const stopRows = await db.all<{ word: string }>(sql`SELECT word FROM stop_words`);
    const stopWords = new Set(stopRows.map(r => r.word.toLowerCase()));
    const keywords = title
        .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
        .split(/\s+/)
        .map(w => stem(w.toLowerCase()))
        .filter(w => w.length > 1 && !stopWords.has(w))
        .slice(0, 3);
    if (keywords.length === 0) return null;
    return keywords.map(k => `"${k.replace(/"/g, '')}"`).join(' OR ');
}

async function findRelatedByFts(env: Bindings, newsId: number, title: string, category?: string | null): Promise<{ id: number; source_name: string; title: string; description: string | null }[]> {
    const db = getDb(env);
    const ftsQuery = await buildPerspectiveFtsQuery(env, title);
    if (!ftsQuery) return [];

    try {
        const ftsIds = await db.all<{ rowid: number }>(
            sql`SELECT rowid FROM news_fts WHERE news_fts MATCH ${sql.raw(`'${ftsQuery}'`)} LIMIT 30`
        );
        if (ftsIds.length === 0) return [];
        const matchedIds = ftsIds.map(r => r.rowid).filter(rid => rid !== newsId).slice(0, 5);
        if (matchedIds.length === 0) return [];

        const rows = await db.all<{ id: number; source_name: string; title: string; description: string | null }>(sql`
            SELECT n.id, s.name as source_name, n.title, n.description
            FROM news_items n LEFT JOIN news_sources s ON n.source_id = s.id
            WHERE n.id IN (${sql.raw(matchedIds.join(','))}) AND n.is_deleted = 0
            ORDER BY CASE WHEN n.category = ${category} THEN 0 ELSE 1 END, n.created_at DESC
            LIMIT 4
        `);
        return rows;
    } catch (e) {
        console.error('findRelatedByFts error:', e);
        return [];
    }
}

export async function generatePerspectives(env: Bindings, newsId: number): Promise<{ related: { id: number; source: string; title: string }[]; perspective: string } | null> {
    const db = getDb(env);
    const cached = await db.select({
        relatedIds: newsPerspectives.related_ids,
        perspective: newsPerspectives.perspective,
    }).from(newsPerspectives)
        .where(eq(newsPerspectives.news_id, newsId))
        .get();

    if (cached) {
        const ids = cached.relatedIds.split(',').map(Number);
        const rows = await db.all<{ id: number; source_name: string; title: string }>(sql`
            SELECT n.id, s.name as source_name, n.title
            FROM news_items n LEFT JOIN news_sources s ON n.source_id = s.id
            WHERE n.id IN (${sql.raw(ids.join(','))})
        `);
        return { related: rows.map(r => ({ id: r.id, source: r.source_name, title: r.title })), perspective: cached.perspective };
    }

    const item = await db.select({
        title: newsItems.title, description: newsItems.description, category: newsItems.category,
    }).from(newsItems)
        .where(and(eq(newsItems.id, newsId), eq(newsItems.is_deleted, 0)))
        .get();

    if (!item) return null;

    const text = `${item.title} ${item.description || ''}`;
    if (text.length < 20) return null;

    try {
        const rows = await findRelatedByFts(env, newsId, item.title, item.category);
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
            const maxModels = await getMaxModelsPerProvider(env);
            const models = await getAvailableModels(env, provider, maxModels);
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
        AND n.created_at >= datetime('now', '-7 days')
        ORDER BY n.created_at DESC
        LIMIT 40
    `);

    if (items.length === 0) {
        console.log('No pending summaries');
        return;
    }

    console.log(`Found ${items.length} items without summaries`);
    const done = await generateBatchSummariesForNews(env, items as any);
    console.log(`Summary generation complete: ${done}/${items.length}`);
}

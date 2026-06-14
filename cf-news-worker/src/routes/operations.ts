import { Hono } from 'hono';
import { Bindings } from '../types';
import { fetchNews } from '../services/newsFetcher';
import { generateSummaryForNews, generateBatchSummariesForNews, generateAITake } from '../services/summarizer';
import { translateText } from '../services/translator';
import { eq, sql, isNull, and } from 'drizzle-orm';
import { getDb } from '../db';
import { appConfig, newsItems, newsSummaries, newsAiTake, providers, providerModels } from '../db/schema';
import { getConfig, getProviderOrder } from '../services/aiProvider';

type NewsRow = { id: number; title: string; description: string | null; content: string | null };

async function loadSummarizeItemsByIds(db: ReturnType<typeof getDb>, ids: number[]): Promise<NewsRow[]> {
    const rows = await Promise.all(
        ids.map(async (id) => {
            const item = await db.select({
                id: newsItems.id,
                title: newsItems.title,
                description: newsItems.description,
                content: newsItems.content,
            }).from(newsItems).where(eq(newsItems.id, id)).get();
            if (!item) return null;

            const existing = await db.select({ id: newsSummaries.id })
                .from(newsSummaries).where(eq(newsSummaries.news_id, id)).get();
            if (existing) return null;

            return item;
        })
    );

    return rows.filter((row): row is NewsRow => row !== null);
}

const operations = new Hono<{ Bindings: Bindings }>();

operations.post('/fetch', async (c) => {
    const db = getDb(c.env);
    const row = await db.select({ value: appConfig.value })
        .from(appConfig).where(eq(appConfig.key, 'last_fetch_time')).get();
    const lastFetch = row?.value;
    const now = Date.now();
    if (lastFetch && (now - parseInt(lastFetch)) < 300000) {
        const remaining = Math.ceil((300000 - (now - parseInt(lastFetch))) / 1000);
        return c.json({ success: false, error: `冷却中，请 ${remaining} 秒后再试` }, 429);
    }
    try {
        await fetchNews(c.env, true);
        await db.insert(appConfig).values({ key: 'last_fetch_time', value: String(now) })
            .onConflictDoUpdate({ target: appConfig.key, set: { value: String(now) } });
        return c.json({ success: true, message: 'News fetch triggered' });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

operations.post('/summarize', async (c) => {
    const db = getDb(c.env);
    try {
        const body = await c.req.json().catch(() => ({}));
        const ids = Array.isArray(body?.ids)
            ? body.ids.map((id: unknown) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0)
            : undefined;

        let items: NewsRow[];
        if (ids && ids.length > 0) {
            items = await loadSummarizeItemsByIds(db, ids);
        } else {
            items = await db.select({
                id: newsItems.id, title: newsItems.title,
                description: newsItems.description, content: newsItems.content,
            })
                .from(newsItems)
                .leftJoin(newsSummaries, eq(newsSummaries.news_id, newsItems.id))
                .where(and(
                    isNull(newsSummaries.id),
                    sql`LENGTH(COALESCE(${newsItems.title}, '') || '. ' || substr(COALESCE(${newsItems.content}, ${newsItems.description}, ''), 1, 1500)) >= 60`
                ))
                .limit(10)
                .all() as any[];
        }

        if (items.length === 0) {
            return c.json({ success: true, generated: 0, total: 0, skipped: 0 });
        }

        const done = await generateBatchSummariesForNews(c.env, items as any);
        return c.json({ success: true, generated: done, total: items.length, skipped: items.length - done });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

operations.post('/summarize/clear', async (c) => {
    const db = getDb(c.env);
    try {
        await db.delete(newsSummaries);
        return c.json({ success: true, message: '所有摘要已清空' });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

operations.post('/summarize/:newsId', async (c) => {
    const newsId = parseInt(c.req.param('newsId'));
    const db = getDb(c.env);
    try {
        const item = await db.select({
            id: newsItems.id, title: newsItems.title,
            description: newsItems.description, content: newsItems.content,
        }).from(newsItems).where(eq(newsItems.id, newsId)).get();
        if (!item) return c.json({ success: false, error: '新闻不存在' }, 404);

        const existing = await db.select({ id: newsSummaries.id })
            .from(newsSummaries).where(eq(newsSummaries.news_id, newsId)).get();
        if (existing) return c.json({ success: true, generated: 0, skipped: true });

        const ok = await generateSummaryForNews(c.env, newsId, item as any);
        return c.json({ success: true, generated: ok ? 1 : 0 });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

operations.post('/take/:newsId', async (c) => {
    const newsId = parseInt(c.req.param('newsId'));
    const db = getDb(c.env);
    try {
        const item = await db.select({
            id: newsItems.id, title: newsItems.title,
            description: newsItems.description, content: newsItems.content,
        }).from(newsItems).where(eq(newsItems.id, newsId)).get();
        if (!item) return c.json({ success: false, error: '新闻不存在' }, 404);

        await generateAITake(c.env, newsId, item as any);
        const row = await db.select({ take: newsAiTake.take })
            .from(newsAiTake).where(eq(newsAiTake.news_id, newsId)).get();
        return c.json({ success: true, take: row?.take || null });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

operations.post('/illustrate/:newsId', async (c) => {
    const newsId = parseInt(c.req.param('newsId'));
    const db = getDb(c.env);
    try {
        const item = await db.select({
            id: newsItems.id, title: newsItems.title,
            description: newsItems.description, content: newsItems.content,
            category: newsItems.category,
        }).from(newsItems).where(eq(newsItems.id, newsId)).get();
        if (!item) return c.json({ success: false, error: '新闻不存在' }, 404);

        const existing = await db.select({ illustration_url: newsSummaries.illustration_url })
            .from(newsSummaries)
            .where(eq(newsSummaries.news_id, newsId))
            .get() as { illustration_url: string | null } | undefined;
        if (existing?.illustration_url) {
            return c.json({ success: true, image_url: existing.illustration_url, cached: true });
        }

        const order = await getProviderOrder(c.env);
        const desc = (item.description || item.content || '').substring(0, 500);
        const contextText = desc.substring(0, 200);
        const prompt = `Create a vivid, specific illustration for this news article. The image should directly depict the subject matter described below.

Title: ${item.title}
Details: ${contextText}

Requirements:
- Depict the specific people, objects, locations, or actions mentioned
- Use appropriate visual style matching the subject (modern for tech, professional for business, dynamic for entertainment)
- Clean composition suitable for a news article header
- No text overlay or watermarks`;

        let imageUrl: string | null = null;
        for (const provider of order) {
            const prov = await db.select({ base_url: providers.base_url, api_key_env: providers.api_key_env })
                .from(providers)
                .where(sql`name = ${provider} AND enabled = 1`)
                .get() as { base_url: string; api_key_env: string } | undefined;
            if (!prov) continue;
            const apiKey = (c.env as any)[prov.api_key_env] as string | undefined;
            if (!apiKey) continue;

            const models = await db.select({ model_id: providerModels.model_id })
                .from(providerModels)
                .where(sql`provider = ${provider} AND enabled = 1 AND type = 'image'`)
                .orderBy(sql`score DESC`)
                .all() as { model_id: string }[];
            if (models.length === 0) continue;

            const baseUrl = prov.base_url.replace(/\/+$/, '');
            for (const m of models) {
                try {
                    const resp = await fetch(`${baseUrl}/images/generations`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
                        body: JSON.stringify({ model: m.model_id, prompt, n: 1, size: '1024x1024' }),
                    });
                    if (!resp.ok) { console.error(`Illustration fail ${provider}/${m.model_id}: ${resp.status}`); continue; }
                    const data = await resp.json() as any;
                    const url = data?.data?.[0]?.url;
                    if (url) { imageUrl = url; break; }
                } catch (e) { console.error(`Illustration error ${provider}/${m.model_id}:`, e); continue; }
            }
            if (imageUrl) break;
        }

        if (!imageUrl) return c.json({ success: false, error: '所有供应商的 AI 插画生成均失败' }, 502);

        await db.run(sql`INSERT OR REPLACE INTO news_summaries (news_id, summary, illustration_url)
            VALUES (${newsId}, '', ${imageUrl})`);
        return c.json({ success: true, image_url: imageUrl, cached: false });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

operations.post('/translate', async (c) => {
    try {
        const { text, lang } = await c.req.json();
        if (!text || !lang) return c.json({ error: 'Missing text or lang' }, 400);
        const translated = await translateText(c.env, text, lang);
        if (!translated) return c.json({ error: 'Translation failed' }, 500);
        return c.json({ translated });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

export default operations;

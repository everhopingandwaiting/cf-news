import { Hono } from 'hono';
import { Bindings } from '../types';
import { fetchNews } from '../services/newsFetcher';
import { generateSummaryForNews, generateBatchSummariesForNews, generateAITake } from '../services/summarizer';
import { translateText } from '../services/translator';
import { eq, sql, isNull, and } from 'drizzle-orm';
import { getDb } from '../db';
import { appConfig, newsItems, newsSummaries, newsAiTake } from '../db/schema';

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

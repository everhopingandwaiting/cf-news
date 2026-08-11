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
    // force=1 供外部监控自愈调用（绕过 5 分钟 cooldown，防止 UptimeRobot 补抓被 429 拦截）
    const force = c.req.query('force') === '1';
    const row = await db.select({ value: appConfig.value })
        .from(appConfig).where(eq(appConfig.key, 'last_fetch_time')).get();
    const lastFetch = row?.value;
    const now = Date.now();
    if (!force && lastFetch && (now - parseInt(lastFetch)) < 300000) {
        const remaining = Math.ceil((300000 - (now - parseInt(lastFetch))) / 1000);
        return c.json({ success: false, error: `冷却中，请 ${remaining} 秒后再试` }, 429);
    }
    try {
        await fetchNews(c.env, true);
        // Best-effort cooldown update (Drizzle ORM ON CONFLICT not fully compatible with D1)
        try {
            const existing = await db.select({ value: appConfig.value })
                .from(appConfig).where(eq(appConfig.key, 'last_fetch_time')).get();
            if (existing) {
                await db.update(appConfig).set({ value: String(now) }).where(eq(appConfig.key, 'last_fetch_time'));
            } else {
                await db.insert(appConfig).values({ key: 'last_fetch_time', value: String(now) });
            }
        } catch (_) { /* cooldown is non-critical */ }
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
                    sql`LENGTH(COALESCE(${newsItems.title}, '') || '. ' || substr(COALESCE(${newsItems.content}, ${newsItems.description}, ''), 1, 1500)) >= 60`,
                    // 只处理近 7 天积压：30 天前的旧闻会被清理任务删除，不值得花 AI 额度
                    sql`${newsItems.created_at} >= datetime('now', '-7 days')`
                ))
                // 入口上限对齐 LARGE_BATCH_MAX=40：zen 可用时一次调用即处理完，
                // 全链失败时 large→small 级联也保持在 Worker 50-subrequest 预算内。
                // newest-first：优先最近文章（旧积压对用户不可见，避免永远轮不到新文章）。
                .orderBy(sql`${newsItems.created_at} DESC`)
                .limit(40)
                .all() as any[];
        }

        if (items.length === 0) {
            return c.json({ success: true, generated: 0, total: 0, skipped: 0 });
        }

        const done = await generateBatchSummariesForNews(c.env, items as any);
        return c.json({ success: true, generated: done, total: items.length, skipped: items.length - done });
    } catch (error: any) {
        // Drizzle 会把 D1 底层错误包装成 "Failed query: ..."，真实原因在 error.cause。
        // 不展开 cause 会导致 "Too many subrequests" 这类平台错误无法定位。
        const cause = error?.cause?.message || error?.cause || '';
        return c.json({ success: false, error: String(error), ...(cause ? { detail: String(cause).substring(0, 500) } : {}) }, 500);
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

        // 将生成的插画持久化到 R2，避免外部临时 URL 过期失效；
        // 成功后 illustration_url 存 r2:// 内部路径，由 /api/image?url=r2://... 统一提供访问
        let storedUrl = imageUrl;
        if (c.env.R2_IMAGES) {
            try {
                const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15_000) });
                const contentType = (imgRes.headers.get('Content-Type') || '').split(';')[0].trim();
                const extMap: Record<string, string> = {
                    'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
                };
                const ext = extMap[contentType];
                if (imgRes.ok && ext) {
                    const key = `illustration/${newsId}.${ext}`;
                    await c.env.R2_IMAGES.put(key, imgRes.body, { httpMetadata: { contentType } });
                    storedUrl = 'r2://' + key;
                }
            } catch (e) {
                console.error('插画 R2 持久化失败，保留原始 URL:', e);
            }
        }

        await db.run(sql`INSERT OR REPLACE INTO news_summaries (news_id, summary, illustration_url)
            VALUES (${newsId}, '', ${storedUrl})`);
        return c.json({ success: true, image_url: storedUrl, cached: false });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

operations.post('/illustrate-stock/:newsId', async (c) => {
    const newsId = parseInt(c.req.param('newsId'));
    const db = getDb(c.env);
    try {
        const item = await db.select({
            id: newsItems.id, title: newsItems.title,
            category: newsItems.category, image_url: newsItems.image_url,
        }).from(newsItems).where(eq(newsItems.id, newsId)).get();
        if (!item) return c.json({ success: false, error: '新闻不存在' }, 404);
        if (item.image_url) {
            return c.json({ success: true, image_url: item.image_url, cached: true });
        }

        const { illustrateFromStock } = await import('../services/pixabay');
        const proxyUrl = await illustrateFromStock(c.env, newsId, item.title, item.category || 'general');
        if (!proxyUrl) {
            return c.json({ success: false, error: 'Pixabay 配图失败（未配置 key、无匹配结果或下载失败）' }, 502);
        }

        await db.update(newsItems)
            .set({ image_url: proxyUrl })
            .where(eq(newsItems.id, newsId));
        return c.json({ success: true, image_url: proxyUrl, cached: false });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

operations.post('/illustrate-stock', async (c) => {
    const db = getDb(c.env);
    try {
        const body = await c.req.json().catch(() => ({}));
        const limit = Math.min(
            Number.isInteger(body?.limit) && (body.limit as number) > 0 ? (body.limit as number) : 10,
            20
        );

        // 只处理最近 30h 的无图新闻（image_url 为空），避免误覆盖已有配图、也避免误配全库历史旧新闻
        const items = await db.select({
            id: newsItems.id, title: newsItems.title,
            category: newsItems.category, image_url: newsItems.image_url,
        })
            .from(newsItems)
            .where(sql`${newsItems.is_deleted} = 0 AND ${newsItems.image_url} IS NULL AND ${newsItems.created_at} >= datetime('now', '-30 hours')`)
            .orderBy(sql`COALESCE(${newsItems.published_at}, ${newsItems.created_at}) DESC`)
            .limit(limit)
            .all() as { id: number; title: string; category: string | null; image_url: string | null }[];

        if (items.length === 0) {
            return c.json({ success: true, total: 0, filled: 0, failed: 0, skipped: 0 });
        }

        const { illustrateFromStock } = await import('../services/pixabay');
        let filled = 0;
        let failed = 0;
        for (const item of items) {
            const proxyUrl = await illustrateFromStock(c.env, item.id, item.title, item.category || 'general');
            if (!proxyUrl) { failed++; continue; }
            await db.update(newsItems)
                .set({ image_url: proxyUrl })
                .where(eq(newsItems.id, item.id));
            filled++;
        }
        return c.json({ success: true, total: items.length, filled, failed, skipped: 0 });
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

import { Hono } from 'hono';
import { Bindings } from '../types';
import { askQuestion, findRelated, getDailyDigest, generateDailyDigest, listDigestDates } from '../services/aiSearch';
import { verifyJWT } from './auth';
import { eq, sql, like, and, ne, or, desc, isNotNull } from 'drizzle-orm';
import { getDb } from '../db';
import { newsItems, newsSources } from '../db/schema';

const router = new Hono<{ Bindings: Bindings }>();

// News Q&A
router.post('/ask', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: '请先登录' }, 401);
    }
    const payload = await verifyJWT(authHeader.substring(7), c.env.JWT_SECRET);
    if (!payload) {
        return c.json({ error: '登录已过期' }, 401);
    }

    try {
        const { question, stream } = await c.req.json();
        if (!question || typeof question !== 'string') {
            return c.json({ error: '请输入问题' }, 400);
        }
        if (question.length > 500) {
            return c.json({ error: '问题太长，请控制在500字以内' }, 400);
        }

        const result = await askQuestion(c.env, question, stream === true);

        if (result instanceof ReadableStream) {
            return new Response(result, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                },
            });
        }

        return c.json({ answer: result.answer, chunks: result.chunks });
    } catch (error) {
        return c.json({ error: '问答生成失败', detail: String(error) }, 500);
    }
});

// Get digest (today or by date)
router.get('/digest', async (c) => {
    try {
        const date = c.req.query('date');
        const digest = await getDailyDigest(c.env, date);
        return c.json({ digest: digest || null });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// List available digest dates
router.get('/digest/dates', async (c) => {
    try {
        const dates = await listDigestDates(c.env);
        return c.json({ dates });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// Force regenerate digest (admin only)
router.post('/digest/generate', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    const payload = await verifyJWT(authHeader.substring(7), c.env.JWT_SECRET);
    if (!payload || !payload.sub) {
        return c.json({ error: '无权限' }, 403);
    }

    try {
        const digest = await generateDailyDigest(c.env);
        return c.json({ success: true, digest });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

let _stopWords: Set<string> | null = null;
async function getStopWords(env: Bindings): Promise<Set<string>> {
    if (_stopWords) return _stopWords;
    const db = getDb(env);
    const rows = await db.all<{ word: string }>(sql`SELECT word FROM stop_words`);
    _stopWords = new Set(rows.map(r => r.word.toLowerCase()));
    return _stopWords;
}

function stem(w: string): string {
    if (w.endsWith('ly')) w = w.slice(0, -2);
    if (w.endsWith('ing')) w = w.slice(0, -3);
    if (w.endsWith('ied')) w = w.slice(0, -3) + 'y';
    else if (w.endsWith('ed')) w = w.slice(0, -2);
    if (w.endsWith('ies')) w = w.slice(0, -3) + 'y';
    else if (w.endsWith('es')) w = w.slice(0, -2);
    else if (w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
    return w;
}

// Related articles (with FTS5 + edge cache)
router.get('/related/:id', async (c) => {
    try {
        const id = parseInt(c.req.param('id'));
        if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

        const cacheVer = await c.env.KV.get('news_cache_ver').catch(() => null) || '0';
        const cacheKey = new Request(`https://related/${id}?cv=${cacheVer}`, {
            headers: { 'Accept': 'application/json' },
        });
        const cached = await caches.default.match(cacheKey);
        if (cached) return cached;

        const db = getDb(c.env);
        const item = await db.select({
            id: newsItems.id, title: newsItems.title, category: newsItems.category,
        }).from(newsItems)
            .where(and(eq(newsItems.id, id), eq(newsItems.is_deleted, 0)))
            .get();
        if (!item) return c.json({ error: 'News not found' }, 404);

        let related: any[] = [];

        // 1) AI Search - only accept results with valid numeric IDs
        const aiRelated = await findRelated(c.env, item.title, 5);
        if (aiRelated.length > 0) {
            related = aiRelated.filter((r: any) => String(r.id).match(/^\d+$/));
        }

        // 2) FTS5 keyword match
        if (related.length === 0) {
            const stopWords = await getStopWords(c.env);
            const keywords = item.title
                .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
                .split(/\s+/)
                .map(w => stem(w.toLowerCase()))
                .filter(w => w.length > 1 && !stopWords.has(w))
                .slice(0, 3);
            if (keywords.length > 0) {
                const ftsQuery = keywords.map(k => `"${k.replace(/"/g, '')}"`).join(' OR ');
                try {
                    // FTS5 MATCH cannot take a bound parameter on D1 — inline
                    // the sanitized query (keywords are word-chars only).
                    const ftsIds = await db.all<{ rowid: number }>(
                        sql`SELECT rowid FROM news_fts WHERE news_fts MATCH ${sql.raw(`'${ftsQuery}'`)} LIMIT 20`
                    );
                    if (ftsIds.length > 0) {
                        const matchedIds = ftsIds.map(r => r.rowid).filter(rid => rid !== id);
                        if (matchedIds.length > 0) {
                            related = await db.select({
                                id: newsItems.id, title: newsItems.title,
                                description: newsItems.description, image_url: newsItems.image_url,
                                published_at: newsItems.published_at,
                            }).from(newsItems)
                                .where(and(
                                    sql`${newsItems.id} IN (${sql.raw(matchedIds.join(','))})`,
                                    eq(newsItems.is_deleted, 0),
                                ))
                                .orderBy(
                                    sql`CASE WHEN category = ${item.category} THEN 0 ELSE 1 END`,
                                    desc(newsItems.created_at)
                                )
                                .limit(5)
                                .all();
                        }
                    }
                } catch (e) {
                    console.error('related FTS fallback error:', e);
                }
            }
        }

        // 3) Same category fallback
        if (related.length === 0) {
            related = await db.select({
                id: newsItems.id, title: newsItems.title,
                description: newsItems.description, image_url: newsItems.image_url,
                published_at: newsItems.published_at,
            }).from(newsItems)
                .where(and(
                    eq(newsItems.category, item.category!),
                    ne(newsItems.id, item.id),
                    eq(newsItems.is_deleted, 0)
                ))
                .orderBy(desc(newsItems.created_at))
                .limit(5)
                .all();
        }

        // Normalize both AI Search chunks ({id,text,score,item}) and DB rows ({id,title,description,image_url})
        const body = JSON.stringify({
            related: related.map((n: any) => ({
                id: String(n.id),
                text: n.title || n.text || '',
                score: n.score ?? 0.5,
                item: {
                    metadata: {
                        description: n.description || n.item?.metadata?.description || null,
                        image_url: n.image_url || n.item?.metadata?.image_url || null,
                    },
                },
            })),
        });

        // Cache at edge for 1h (free, unlimited)
        const res = new Response(body, {
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'public, max-age=3600, s-maxage=3600',
            },
        });
        c.executionCtx.waitUntil(caches.default.put(cacheKey, res.clone()));
        return res;
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// POST /trending/insight — AI-generated explanation for why a keyword is trending.
router.post('/trending/insight', async (c) => {
    try {
        const { keyword, hours } = await c.req.json<{ keyword: string; hours?: number }>();
        if (!keyword || typeof keyword !== 'string') {
            return c.json({ error: '请输入关键词' }, 400);
        }
        const period = hours || 24;

        const escaped = keyword.replace(/[%_]/g, '=$&');
        const db = getDb(c.env);
        const newsRows = await db.all<{
            title: string; description: string; source_name: string; published_at: string;
        }>(sql`
            SELECT n.title, n.description, ns.name as source_name, n.published_at
            FROM news_items n
            LEFT JOIN news_sources ns ON n.source_id = ns.id
            WHERE n.created_at >= datetime('now', '-' || ${period} || ' hours')
              AND n.is_deleted = 0
              AND (n.title LIKE ${`%${escaped}%`} ESCAPE '=' OR n.description LIKE ${`%${escaped}%`} ESCAPE '=')
            ORDER BY n.published_at DESC
            LIMIT 8
        `);

        if (newsRows.length === 0) {
            return c.json({ insight: `近期没有找到与"${keyword}"相关的新闻报道。` });
        }

        const articles = newsRows.map((r, i) =>
            `标题: ${r.title}\n来源: ${r.source_name || '未知'}\n摘要: ${(r.description || '').substring(0, 200)}`
        ).join('\n---\n');

        const { callAI } = await import('../services/aiProvider');
        const insight = await callAI(c.env,
            `以下是关于"${keyword}"的近期新闻报道。请用中文给出1-2句话的分析，解释为什么这个词最近很热门，指出主要原因或事件。语气简洁客观。\n\n${articles}\n\n分析:`,
            { system_prompt: '你是一个新闻趋势分析师。用简洁的中文分析关键词走红原因，不超过100字。', max_tokens: 300 }
        );

        return c.json({ insight: (insight || '').trim() || `未找到关于"${keyword}"的充分分析数据。` });
    } catch (error) {
        return c.json({ error: '生成分析失败', detail: String(error) }, 500);
    }
});

// Debug: test stream connection
router.post('/debug/stream', async (c) => {
    const results: any[] = [];
    const { getProviderOrder, getModels, getProviderInfo } = await import('../services/aiProvider');

    const order = await getProviderOrder(c.env);
    for (const provider of order) {
        if (provider === 'cloudflare') {
            const models = await getModels(c.env, 'cloudflare');
            for (const model of models) {
                try {
                    const stream = await c.env.AI.run(model, {
                        messages: [{ role: 'user', content: 'hi' }],
                        stream: true,
                        max_tokens: 10,
                    }) as any;
                    results.push({ provider, model, status: 'ok', hasStream: !!stream, type: typeof stream });
                } catch (e: any) {
                    results.push({ provider, model, status: 'error', error: String(e) });
                }
            }
        } else {
            const info = await getProviderInfo(c.env, provider);
            if (!info) { results.push({ provider, status: 'no_config' }); continue; }
            const models = await getModels(c.env, provider);
            for (const model of models) {
                try {
                    const url = info.base_url.endsWith('/') ? `${info.base_url}chat/completions` : `${info.base_url}/chat/completions`;
                    const res = await fetch(url, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${info.api_key}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ model, messages: [{ role: 'user', content: 'hi' }], stream: true, max_tokens: 10 }),
                        signal: AbortSignal.timeout(10000),
                    });
                    results.push({ provider, model, status: res.ok ? 'ok' : 'error', httpStatus: res.status, error: res.ok ? null : await res.text().catch(() => '') });
                } catch (e: any) {
                    results.push({ provider, model, status: 'error', error: String(e) });
                }
            }
        }
    }
    return c.json(results);
});

export default router;

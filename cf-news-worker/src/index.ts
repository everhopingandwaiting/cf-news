import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Bindings } from './types';

import authRoutes from './routes/auth';
import newsRoutes from './routes/news';
import userRoutes from './routes/user';
import commentsRoutes from './routes/comments';
import adminRoutes from './routes/admin';
import aiRoutes from './routes/ai';
import { fetchNews } from './services/newsFetcher';
import { fetchRichArticleContent } from './services/contentFetcher';
import { generateSummaryForNews, generateBatchSummariesForNews, generateAITake } from './services/summarizer';
import { sendDailyDigest } from './services/emailDigest';
import { generateDailyDigest } from './services/aiSearch';
import { translateText } from './services/translator';
import { verifyJWT } from './routes/auth';
import { handleNewsQueue } from './services/queueConsumer';
export { ClipboardRoom } from './durable-objects/clipboard';
export { CommentsRoom } from './durable-objects/comments';
export { PipingRoom } from './durable-objects/piping';

const app = new Hono<{ Bindings: Bindings }>();

// Global rate limiting middleware (100 req/min per IP)
app.use('/api/*', async (c, next) => {
    const ip = c.req.header('CF-Connecting-IP') || c.req.header('X-Forwarded-For') || 'unknown';
    const { success } = await c.env.GLOBAL_RATE_LIMITER.limit({ key: ip });
    if (!success) {
        return c.json({ error: 'Rate limit exceeded' }, 429);
    }
    await next();
});

async function generatePendingSummaries(env: Bindings): Promise<void> {
    console.log('Generating pending AI summaries...');
    // Enrich items with short RSS content first (max 5 per run, separated from fetch to avoid 50-req limit)
    const shortItems = await env.DB.prepare(
        `SELECT id, title, url FROM news_items 
         WHERE LENGTH(COALESCE(content,'')) < 300 AND LENGTH(COALESCE(description,'')) < 300
         AND url IS NOT NULL LIMIT 5`
    ).all<{ id: number; title: string; url: string }>();
    for (const item of shortItems.results) {
        try {
            const rich = await fetchRichArticleContent(item.url);
            if (rich) {
                await env.DB.prepare(
                    'UPDATE news_items SET content = ?, description = ? WHERE id = ?'
                ).bind(rich.html, rich.text, item.id).run();
                console.log(`Enriched: "${item.title.substring(0, 40)}"`);
            }
        } catch (e) {
            console.error(`Enrich failed for "${item.title}":`, e);
        }
    }
    // Then generate summaries for items missing them
    const items = await env.DB.prepare(
        `SELECT n.id, n.title, n.description, n.content 
         FROM news_items n LEFT JOIN news_summaries ns ON ns.news_id = n.id 
         WHERE ns.id IS NULL AND (n.description IS NOT NULL OR n.content IS NOT NULL)
         LIMIT 10`
    ).all<{ id: number; title: string; description: string; content: string }>();

    if (items.results.length === 0) {
        console.log('No pending summaries');
        return;
    }

    console.log(`Found ${items.results.length} items without summaries`);
    const done = await generateBatchSummariesForNews(env, items.results);
    console.log(`Summary generation complete: ${done}/${items.results.length}`);
}

app.use('/api/*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}));

app.route('/api/auth', authRoutes);
app.route('/api/news', newsRoutes);
app.route('/api/comments', commentsRoutes);

app.use('/api/user/*', async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    await next();
});
app.route('/api/user', userRoutes);

// Admin routes (require auth)
app.use('/api/admin/*', async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    const payload = await verifyJWT(authHeader.substring(7), c.env.JWT_SECRET);
    if (!payload || payload.sub !== 1) {
        return c.json({ error: '无权限' }, 403);
    }
    await next();
});
app.route('/api/admin', adminRoutes);

app.route('/api/ai', aiRoutes);



app.get('/api/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/config', (c) => {
    return c.json({
        turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || '',
    });
});

app.post('/api/fetch', async (c) => {
    const row = await c.env.DB.prepare("SELECT value FROM app_config WHERE key = 'last_fetch_time'").first<{ value: string }>();
    const lastFetch = row?.value;
    const now = Date.now();
    if (lastFetch && (now - parseInt(lastFetch)) < 300000) {
        const remaining = Math.ceil((300000 - (now - parseInt(lastFetch))) / 1000);
        return c.json({ success: false, error: `冷却中，请 ${remaining} 秒后再试` }, 429);
    }
    try {
        await fetchNews(c.env, true);
        await c.env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('last_fetch_time', ?)").bind(String(now)).run();
        return c.json({ success: true, message: 'News fetch triggered' });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

app.post('/api/summarize', async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const ids = body?.ids as number[] | undefined;

        let items: any;
        if (ids && ids.length > 0) {
            const placeholders = ids.map(() => '?').join(',');
            items = await c.env.DB.prepare(
                `SELECT id, title, description, content FROM news_items WHERE id IN (${placeholders})`
            ).bind(...ids).all<{ id: number; title: string; description: string; content: string }>();
        } else {
            items = await c.env.DB.prepare(
                `SELECT n.id, n.title, n.description, n.content 
                 FROM news_items n LEFT JOIN news_summaries ns ON ns.news_id = n.id 
                 WHERE ns.id IS NULL AND (n.description IS NOT NULL OR n.content IS NOT NULL)
                 LIMIT 10`
            ).all<{ id: number; title: string; description: string; content: string }>();
        }

        const done = await generateBatchSummariesForNews(c.env, items.results);
        return c.json({ success: true, generated: done, total: items.results.length });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

app.post('/api/summarize/:newsId', async (c) => {
    const newsId = parseInt(c.req.param('newsId'));
    try {
        const item = await c.env.DB.prepare(
            'SELECT id, title, description, content FROM news_items WHERE id = ?'
        ).bind(newsId).first<{ id: number; title: string; description: string; content: string }>();
        if (!item) return c.json({ success: false, error: '新闻不存在' }, 404);
        const existing = await c.env.DB.prepare('SELECT id FROM news_summaries WHERE news_id = ?').bind(newsId).first();
        if (existing) {
            return c.json({ success: true, generated: 0, skipped: true });
        }

        const ok = await generateSummaryForNews(c.env, newsId, item);
        return c.json({ success: true, generated: ok ? 1 : 0 });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// 同步生成 AI 吐槽（等待完成）
app.post('/api/take/:newsId', async (c) => {
    const newsId = parseInt(c.req.param('newsId'));
    try {
        const item = await c.env.DB.prepare(
            'SELECT id, title, description, content FROM news_items WHERE id = ?'
        ).bind(newsId).first<{ id: number; title: string; description: string; content: string }>();
        if (!item) return c.json({ success: false, error: '新闻不存在' }, 404);
        await generateAITake(c.env, newsId, item);
        const row = await c.env.DB.prepare('SELECT take FROM news_ai_take WHERE news_id = ?').bind(newsId).first<{ take: string }>();
        return c.json({ success: true, take: row?.take || null });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

app.post('/api/summarize/clear', async (c) => {
    try {
        await c.env.DB.prepare('DELETE FROM news_summaries').run();
        return c.json({ success: true, message: '所有摘要已清空' });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

app.post('/api/translate', async (c) => {
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

// Asia/Shanghai hour bucket string "YYYY-MM-DD HH:00:00". trending_topics.date_hour
// is stored in Shanghai time so the 24h window aligns with the user's local day.
function shanghaiHourString(d: Date = new Date()): string {
    const shanghaiMs = d.getTime() + 8 * 3600 * 1000;
    return new Date(shanghaiMs).toISOString().substring(0, 19).replace('T', ' ');
}

// Lowercase, keep alphanumerics + CJK + collapse internal whitespace to underscores.
// This is the canonical form stored in trending_topics.keyword and used for matching.
function normalizeKeyword(s: string): string {
    return s
        .trim()
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff\s]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

// Hourly cron job: pick trending keywords from the last 24h, then store the
// current hour's bucket atomically. LLM proposes keywords only; D1 counts the
// real article matches so the count is data, not a model guess.
export async function refreshTrendingTopics(env: Bindings): Promise<{ status: string; detail?: any }> {
    try {
        const rows = await env.DB.prepare(`
            SELECT id, title, description, created_at FROM news_items
            WHERE is_deleted = 0 AND created_at > datetime('now', '-1 day')
            ORDER BY created_at DESC LIMIT 60
        `).all<{ id: number; title: string; description: string | null; created_at: string }>();
        if (rows.results.length < 3) {
            return { status: 'no_news', detail: { count: rows.results.length } };
        }

        const titles = rows.results.map(r => r.title);

        const stopRows = await env.DB.prepare('SELECT word FROM stop_words').all<{ word: string }>();
        const stopSet = new Set(stopRows.results.map(r => normalizeKeyword(r.word)));

        const prompt = `分析以下新闻标题，提取当前最热门的10-15个话题/关键词。
要求：
- 英文全部用小写、单词间用下划线连接（如 ai_model、openai、gpt_5），便于程序归一
- 中文用 2-4 字短词或常见术语（如 量子计算、机器学习、苹果）
- 不要"AI"、"科技"、"公司"等过于通用的词
- 优先识别具体事件/产品/人物/技术名词
- 返回JSON数组，格式：[{"keyword":"..."}]，不要 count 字段
- 只返回JSON，不要其他文字

新闻标题：
${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

        const resp = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
            messages: [
                { role: 'system', content: '你是一个新闻热点分析师。只返回JSON。' },
                { role: 'user', content: prompt },
            ],
            max_tokens: 4096,
        });
        const textRaw = (resp as any).response ?? (resp as any).choices?.[0]?.message?.content ?? '';
        const text = typeof textRaw === 'string' ? textRaw : JSON.stringify(textRaw);
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            return { status: 'no_json', detail: { rawLen: text.length, rawHead: text.slice(0, 200), rawTail: text.slice(-200) } };
        }

        let raw: unknown;
        try { raw = JSON.parse(jsonMatch[0]); } catch (e) {
            return { status: 'json_parse_failed', detail: { match: jsonMatch[0].slice(0, 200) } };
        }
        if (!Array.isArray(raw)) {
            return { status: 'not_array', detail: { type: typeof raw } };
        }

        const seen = new Set<string>();
        const keywords: string[] = [];
        for (const item of raw) {
            if (!item || typeof (item as any).keyword !== 'string') continue;
            const norm = normalizeKeyword((item as any).keyword);
            if (norm.length < 2) continue;
            if (stopSet.has(norm)) continue;
            if (seen.has(norm)) continue;
            seen.add(norm);
            keywords.push(norm);
        }
        if (keywords.length === 0) {
            return { status: 'no_valid_keywords', detail: { llmCount: raw.length, sampleKeywords: raw.slice(0, 3), stopSetSize: stopSet.size } };
        }

        const shaOneHourAgo = `datetime('now', '+7 hours')`;
        const shaNow = `datetime('now', '+8 hours')`;
        const countResults = await env.DB.batch(
            keywords.map(kw =>
                env.DB.prepare(
                    `SELECT COUNT(*) as c FROM news_items
                     WHERE created_at > ${shaOneHourAgo}
                       AND created_at < ${shaNow}
                       AND (title LIKE ? OR description LIKE ?)`
                ).bind(`%${kw}%`, `%${kw}%`)
            )
        );
        const valid = keywords
            .map((kw, i) => ({ keyword: kw, count: Number((countResults[i]?.results?.[0] as { c?: number } | undefined)?.c ?? 0) }))
            .filter(t => t.count > 0)
            .slice(0, 20);
        if (valid.length === 0) {
            return { status: 'no_articles_matched', detail: { llmKeywords: keywords, countResults: countResults.slice(0, 3) } };
        }

        // Atomic replace: DELETE the current Shanghai hour bucket, then INSERT new rows.
        // D1 batch is transactional; if any statement fails, the whole thing rolls back
        // and the previous hour's data stays intact.
        const dateHour = shanghaiHourString();
        const statements = [
            env.DB.prepare('DELETE FROM trending_topics WHERE date_hour = ?').bind(dateHour),
            ...valid.map(t =>
                env.DB.prepare('INSERT INTO trending_topics (keyword, date_hour, count) VALUES (?, ?, ?)')
                    .bind(t.keyword, dateHour, t.count)
            ),
        ];
        await env.DB.batch(statements);
        return { status: 'ok', detail: { dateHour, keywordsWritten: valid.length, sample: valid.slice(0, 5) } };
    } catch (e: any) {
        return { status: 'exception', detail: { message: e?.message || String(e), stack: e?.stack?.split('\n').slice(0, 3).join('\n') } };
    }
}

export default {
    async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
        const reqUrl = new URL(request.url);
        // Image proxy - fetch external images through CF edge cache
        if (reqUrl.pathname === '/api/image' && reqUrl.searchParams.has('url')) {
            const imgUrl = reqUrl.searchParams.get('url')!;
            const imgRes = await fetch(imgUrl, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CFNewsImage/1.0)', 'Referer': '' },
            });
            const imgBody = imgRes.ok ? imgRes.body : null;
            return new Response(imgBody, {
                status: imgRes.status,
                headers: {
                    'Content-Type': imgRes.headers.get('Content-Type') || 'image/jpeg',
                    'Cache-Control': 'public, max-age=86400, s-maxage=604800',
                    'Access-Control-Allow-Origin': '*',
                },
            });
        }
        // Share endpoint: /share/:id — OG preview for social media crawlers
        if (reqUrl.pathname.startsWith('/share/')) {
            const id = reqUrl.pathname.split('/')[2];
            if (id && !isNaN(Number(id))) {
                const ua = request.headers.get('User-Agent') || '';
                const isCrawler = /facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|pinterest|baiduspider|googlebot|bingbot|yandexbot/i.test(ua);
                if (isCrawler) {
                    try {
                        const item = await env.DB.prepare(
                            'SELECT title, description, image_url FROM news_items WHERE id = ?'
                        ).bind(Number(id)).first<{ title: string; description: string; image_url: string }>();
                        if (item) {
                            // 优先用 AI 摘要，没有再用原文描述
                            const summary = await env.DB.prepare('SELECT summary FROM news_summaries WHERE news_id = ?').bind(Number(id)).first<{ summary: string }>();
                            const desc = (summary?.summary || item.description || '').replace(/<[^>]+>/g, '').substring(0, 200);
                            // 图片走 CF 代理避免防盗链
                            const imgUrl = item.image_url ? `/api/image?url=${encodeURIComponent(item.image_url)}` : '';
                            const shareUrl = `https://${reqUrl.hostname}/share/${id}`;
                            return new Response(`<!DOCTYPE html><html><head>
<meta charset="utf-8"><title>${item.title}</title>
<meta property="og:title" content="${item.title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${shareUrl}">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${item.title}">
<meta name="twitter:description" content="${desc}">
${imgUrl ? `<meta property="og:image" content="${imgUrl}"><meta name="twitter:image" content="${imgUrl}">` : ''}
<meta http-equiv="refresh" content="0;url=/?id=${id}">
</head><body>Redirecting...</body></html>`, {
                                headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
                            });
                        }
                    } catch {}
                }
                // 非爬虫 → 返回 SPA HTML（从自身拉 index.html）
                const spaRes = await fetch(new URL('/', request.url));
                return new Response(spaRes.body, {
                    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
                });
            }
        }
        // WebSocket upgrade for real-time comments
        if (reqUrl.pathname === '/api/comments/ws') {
            const token = reqUrl.searchParams.get('token');
            const newsId = reqUrl.searchParams.get('newsId');
            if (!token || !newsId) return new Response('Missing params', { status: 401 });
            const payload = await verifyJWT(token, env.JWT_SECRET);
            if (!payload) return new Response('Invalid token', { status: 403 });
            const user = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(payload.sub).first<{ username: string }>();
            if (!user) return new Response('User not found', { status: 404 });
            const stub = env.COMMENTS.get(env.COMMENTS.idFromName(newsId));
            const wsUrl = new URL(request.url);
            wsUrl.searchParams.set('uid', String(payload.sub));
            wsUrl.searchParams.set('newsId', newsId);
            wsUrl.searchParams.set('username', user.username || payload.email);
            return stub.fetch(new Request(wsUrl.toString(), request));
        }

        // WebSocket upgrade for clipboard sharing
        if (reqUrl.pathname === '/api/clipboard/ws') {
            const token = reqUrl.searchParams.get('token');
            if (!token) return new Response('Missing token', { status: 401 });
            const payload = await verifyJWT(token, env.JWT_SECRET);
            if (!payload) return new Response('Invalid token', { status: 403 });
            const stub = env.CLIPBOARD.get(env.CLIPBOARD.idFromName(String(payload.sub)));
            const wsUrl = new URL(request.url);
            wsUrl.searchParams.delete('token');
            wsUrl.searchParams.set('uid', String(payload.sub));
            return stub.fetch(new Request(wsUrl.toString(), request));
        }
        // Screenshot via Browser Rendering
        if (reqUrl.pathname === '/api/screenshot' && reqUrl.searchParams.has('url')) {
            try {
                const ssUrl = reqUrl.searchParams.get('url')!;
                const resp = await env.BROWSER.fetch('https://browser-rendering.cloudflare.com/chrome-screenshot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ url: ssUrl, viewport: { width: 1280, height: 720 } }),
                });
                if (!resp.ok) return new Response(await resp.text() || 'Failed', { status: 502 });
                return new Response(resp.body, {
                    headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
                });
            } catch (e: any) {
                return new Response(e.message || 'Error', { status: 502 });
            }
        }

        // HTTP piping for file transfer (PUT upload / GET download)
        const pipingMatch = reqUrl.pathname.match(/^\/api\/piping\/(upload|download)\/(.+)$/);
        if (pipingMatch) {
            const stub = env.PIPING.get(env.PIPING.idFromName(pipingMatch[2]));
            const pipingUrl = new URL(request.url);
            return stub.fetch(new Request(pipingUrl.toString(), request));
        }


        if (reqUrl.pathname.startsWith('/api/')) {
            return app.fetch(request, env, ctx);
        }
        // Non-API routes are handled by [assets] with SPA fallback
        return app.fetch(request, env, ctx);
    },

    async scheduled(event: ScheduledEvent, env: Bindings, ctx: ExecutionContext): Promise<void> {
        if (event.cron === '0 * * * *') {
            console.log('Fetch cron fired, fetching news...');
            ctx.waitUntil(fetchNews(env, true));
        } else if (event.cron === '*/15 * * * *') {
            console.log('Trending cron fired, refreshing topics...');
            ctx.waitUntil(refreshTrendingTopics(env));
        } else if (event.cron === '0 8 * * *') {
            console.log('Daily digest cron fired, generating digest...');
            ctx.waitUntil(generateDailyDigest(env).then(r => console.log(`Digest: ${r ? 'generated' : 'skipped'}`)));
            console.log('Daily digest email cron fired, sending emails...');
            ctx.waitUntil(sendDailyDigest(env).then(r => console.log(`Digest: sent=${r.sent}, failed=${r.failed}`)));
        } else {
            console.log('Summary cron fired, generating summaries...');
            ctx.waitUntil(generatePendingSummaries(env));
        }
    },

    async queue(batch: MessageBatch<any>, env: Bindings): Promise<void> {
        await handleNewsQueue(batch, env);
    }
};

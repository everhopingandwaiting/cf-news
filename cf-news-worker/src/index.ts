import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Bindings } from './types';

import authRoutes from './routes/auth';
import newsRoutes from './routes/news';
import userRoutes from './routes/user';
import commentsRoutes from './routes/comments';
import adminRoutes from './routes/admin';
import { fetchNews } from './services/newsFetcher';
import { fetchRichArticleContent } from './services/contentFetcher';
import { generateSummaryForNews, generateAITake } from './services/summarizer';
import { sendDailyDigest } from './services/emailDigest';
import { translateText } from './services/translator';
import { verifyJWT } from './routes/auth';
import { logVisitor } from './services/analytics';
export { ClipboardRoom } from './durable-objects/clipboard';
export { CommentsRoom } from './durable-objects/comments';

const app = new Hono<{ Bindings: Bindings }>();

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
    let done = 0;
    for (let i = 0; i < items.results.length; i += 2) {
        const batch = items.results.slice(i, i + 2);
        const results = await Promise.allSettled(
            batch.map(item => generateSummaryForNews(env, item.id, item))
        );
        done += results.filter(r => r.status === 'fulfilled' && r.value).length;
    }
    console.log(`Summary generation complete: ${done}/${items.results.length}`);
}

app.use('/api/*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}));

app.use('/api/*', async (c, next) => {
    const start = Date.now();
    await next();
    const elapsed = Date.now() - start;
    const path = new URL(c.req.url).pathname;
    const authHeader = c.req.header('Authorization');
    let userId: number | undefined;
    if (authHeader?.startsWith('Bearer ')) {
        try {
            const payload = await verifyJWT(authHeader.substring(7), c.env.JWT_SECRET);
            if (payload) userId = payload.sub;
        } catch {}
    }
    c.executionCtx.waitUntil(logVisitor(c.env, c.req.raw, path, c.res.status, elapsed, userId));
});

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



app.get('/api/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.post('/api/fetch', async (c) => {
    const lastFetch = await c.env.KV.get('last_fetch_time');
    const now = Date.now();
    if (lastFetch && (now - parseInt(lastFetch)) < 300000) {
        const remaining = Math.ceil((300000 - (now - parseInt(lastFetch))) / 1000);
        return c.json({ success: false, error: `冷却中，请 ${remaining} 秒后再试` }, 429);
    }
    try {
        await fetchNews(c.env, true);
        await c.env.KV.put('last_fetch_time', String(now));
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

        // Process in batches of 2 to avoid overwhelming API limits
        let done = 0;
        for (let i = 0; i < items.results.length; i += 2) {
            const batch = items.results.slice(i, i + 2);
            const results = await Promise.allSettled(
                batch.map((item: { id: number; title: string; description: string; content: string }) => generateSummaryForNews(c.env, item.id, item))
            );
            done += results.filter(r => r.status === 'fulfilled' && r.value).length;
        }
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
        } else if (event.cron === '0 8 * * *') {
            console.log('Daily digest cron fired, sending emails...');
            ctx.waitUntil(sendDailyDigest(env).then(r => console.log(`Digest: sent=${r.sent}, failed=${r.failed}`)));
        } else {
            console.log('Summary cron fired, generating summaries...');
            ctx.waitUntil(generatePendingSummaries(env));
        }
    }
};

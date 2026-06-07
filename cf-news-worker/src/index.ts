import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Bindings } from './types';

import authRoutes from './routes/auth';
import newsRoutes from './routes/news';
import userRoutes from './routes/user';
import commentsRoutes from './routes/comments';
import adminRoutes from './routes/admin';
import aiRoutes from './routes/ai';
import operationRoutes from './routes/operations';
import favoritesRoutes from './routes/favorites';
import historyRoutes from './routes/history';
import trendingRoutes from './routes/trending';

import { fetchNews } from './services/newsFetcher';
import { sendDailyDigest } from './services/emailDigest';
import { generateDailyDigest } from './services/aiSearch';
import { verifyJWT } from './routes/auth';
import { handleNewsQueue } from './services/queueConsumer';
import { refreshTrendingTopics } from './services/trending';
import { generatePendingSummaries } from './services/summarizer';

import { handleImageProxy } from './routes/image';
import { handleScreenshot } from './routes/screenshot';
import { handleShare } from './routes/share';

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

app.use('/api/*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
}));

app.route('/api/auth', authRoutes);
app.route('/api/news', trendingRoutes);
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
app.route('/api/user', favoritesRoutes);
app.route('/api/user', historyRoutes);

// Admin routes (require auth + admin role)
app.use('/api/admin/*', async (c, next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    const payload = await verifyJWT(authHeader.substring(7), c.env.JWT_SECRET);
    if (!payload || payload.role !== 'admin') {
        return c.json({ error: '无权限' }, 403);
    }
    await next();
});
app.route('/api/admin', adminRoutes);

app.route('/api/ai', aiRoutes);
app.route('/api', operationRoutes);

app.get('/api/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/config', (c) => {
    return c.json({
        turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || '',
    });
});

export default {
    async fetch(request: Request, env: Bindings, ctx: ExecutionContext): Promise<Response> {
        const reqUrl = new URL(request.url);

        // Image proxy — fetch external images through CF edge cache
        if (reqUrl.pathname === '/api/image' && reqUrl.searchParams.has('url')) {
            const resp = await handleImageProxy(request, env);
            if (resp) return resp;
        }

        // Share endpoint — OG preview for social media crawlers
        if (reqUrl.pathname.startsWith('/share/')) {
            const resp = await handleShare(request, env);
            if (resp) return resp;
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
            const resp = await handleScreenshot(request, env);
            if (resp) return resp;
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
        // SPA: serve index.html with no-cache so browsers always get latest JS hashes
        if (reqUrl.pathname === '/' || reqUrl.pathname === '/index.html') {
            const res = await app.fetch(request, env, ctx);
            const headers = new Headers(res.headers);
            headers.set('Cache-Control', 'no-cache, no-store, must-revalidate');
            return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
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

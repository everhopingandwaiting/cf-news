import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { Bindings } from './types';

import authRoutes from './routes/auth';
import newsRoutes from './routes/news';
import userRoutes from './routes/user';
import commentsRoutes from './routes/comments';
import entitiesRoutes from './routes/entities';
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
import { checkRadarPush } from './services/radarPush';
import { generatePendingSummaries } from './services/summarizer';
import { refreshModelCatalog } from './services/modelRefresher';

import { handleImageProxy } from './routes/image';
import { handleScreenshot } from './routes/screenshot';
import { handleShare } from './routes/share';
import { handleInboundEmail } from './routes/emailInbound';
import { getDb } from './db';
import { newsItems, cronHeartbeat } from './db/schema';
import { sql, eq } from 'drizzle-orm';

export { ClipboardRoom } from './durable-objects/clipboard';
export { CommentsRoom } from './durable-objects/comments';
export { PipingRoom } from './durable-objects/piping';
export { BackfillWorkflow } from './workflows/backfillWorkflow';

const app = new Hono<{ Bindings: Bindings }>();

async function checkApiRateLimit(request: Request, env: Bindings): Promise<Response | null> {
    const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
    const { success } = await env.GLOBAL_RATE_LIMITER.limit({ key: ip });
    return success ? null : new Response('Rate limit exceeded', { status: 429 });
}

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
app.route('/api/news', entitiesRoutes);
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
app.route('/api/user/favorites', favoritesRoutes);
app.route('/api/user/history', historyRoutes);

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

import ttsRoutes from './routes/tts';
app.route('/api', ttsRoutes);

app.get('/api/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 数据新鲜度健康检查：供外部监控（UptimeRobot / cron-job）探测。检测两个维度：
// 1) 最近是否有新新闻入库（news_items 停滞 >6h 视为异常）
// 2) cron 调度是否仍触发（fetch cron 心跳缺失 >2h 视为异常）
app.get('/api/health/feed', async (c) => {
    const db = getDb(c.env);
    const now = Date.now();
    const problems: string[] = [];

    const newsRow = await db.select({ ts: newsItems.created_at })
        .from(newsItems).orderBy(sql`created_at DESC`).limit(1).get();
    const lastNewsMs = newsRow?.ts ? parseDbTs(newsRow.ts) : 0;
    const newsAgeMin = lastNewsMs ? Math.round((now - lastNewsMs) / 60000) : -1;
    if (newsAgeMin < 0 || newsAgeMin > 360) {
        problems.push(`news_items stale (age=${newsAgeMin}min)`);
    }

    const hbRow = await db.select({ ts: cronHeartbeat.last_fired_at })
        .from(cronHeartbeat).where(eq(cronHeartbeat.cron_name, '0 * * * *')).get();
    const hbMs = hbRow?.ts ? parseDbTs(hbRow.ts) : 0;
    const hbAgeMin = hbMs ? Math.round((now - hbMs) / 60000) : -1;
    if (hbAgeMin < 0 || hbAgeMin > 120) {
        problems.push(`fetch cron heartbeat stale (age=${hbAgeMin}min)`);
    }

    return c.json({
        ok: problems.length === 0,
        lastNewsAt: newsRow?.ts || null,
        newsAgeMinutes: newsAgeMin,
        lastFetchCronAt: hbRow?.ts || null,
        fetchCronAgeMinutes: hbAgeMin,
        problems,
        timestamp: new Date().toISOString(),
    });
});

app.get('/api/config', (c) => {
    // VAPID_PUBLIC_KEY 是 hex 编码的 65 字节未压缩 P-256 点，转为 base64url 供前端 pushManager.subscribe
    const vapidHex = c.env.VAPID_PUBLIC_KEY || '';
    let vapidPublicKey = '';
    if (vapidHex) {
        const bytes = new Uint8Array(vapidHex.length / 2);
        for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(vapidHex.slice(i * 2, i * 2 + 2), 16);
        let bin = '';
        bytes.forEach(b => bin += String.fromCharCode(b));
        vapidPublicKey = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    return c.json({
        turnstileSiteKey: c.env.TURNSTILE_SITE_KEY || '',
        vapidPublicKey,
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
            const limited = await checkApiRateLimit(request, env);
            if (limited) return limited;
            const token = reqUrl.searchParams.get('token');
            const newsId = reqUrl.searchParams.get('newsId');
            if (!token || !newsId) return new Response('Missing params', { status: 401 });
            const payload = await verifyJWT(token, env.JWT_SECRET);
            if (!payload) return new Response('Invalid token', { status: 403 });
            const user = await import('./db').then(m => {
                const db = m.getDb(env);
                return import('./db/schema').then(s => import('drizzle-orm').then(d => 
                    db.select({ username: s.users.username }).from(s.users).where(d.eq(s.users.id, payload.sub)).get()
                ));
            });
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
            const limited = await checkApiRateLimit(request, env);
            if (limited) return limited;
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
            const limited = await checkApiRateLimit(request, env);
            if (limited) return limited;
            const authHeader = request.headers.get('Authorization');
            const token = authHeader?.startsWith('Bearer ')
                ? authHeader.substring(7)
                : null;
            if (!token) return new Response('Missing token', { status: 401 });
            const payload = await verifyJWT(token, env.JWT_SECRET);
            if (!payload) return new Response('Invalid token', { status: 403 });
            const stub = env.PIPING.get(env.PIPING.idFromName(`${payload.sub}:${pipingMatch[2]}`));
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
            // skipSummary=true：抓取只入队 fetch_source，摘要全部交给 summary cron
            // (*/5 * * * *)。之前 skipSummary=false 会让 saveNewsItems 为每条新文章同步
            // 入队 generate_summary，consumer 处理时每条遍历 8 providers×2 models
            // 的外部 fetch 会爆 Worker 50-subrequest 限制（实测每小时 40-53 次
            // "Too many subrequests"），堆积的毒消息把 fetch_source 挤到队尾饿死。
            ctx.waitUntil(fetchNews(env, true));
        } else if (event.cron === '*/15 * * * *') {
            console.log('Trending cron fired, refreshing topics...');
            ctx.waitUntil(refreshTrendingTopics(env));
            // 新闻雷达关键词命中检查 → 触发 Web Push 通知
            ctx.waitUntil(checkRadarPush(env));
        } else if (event.cron === '0 8 * * *') {
            console.log('Daily digest cron fired, generating digest...');
            ctx.waitUntil(generateDailyDigest(env).then(r => console.log(`Digest: ${r ? 'generated' : 'skipped'}`)));
            console.log('Daily digest email cron fired, sending emails...');
            ctx.waitUntil(sendDailyDigest(env).then(r => console.log(`Digest: sent=${r.sent}, failed=${r.failed}`)));
        } else if (event.cron === '*/5 * * * *') {
            // Summary cron: 唯一生成摘要的入口（fetch cron 已 skipSummary=true，
            // 不再入队 generate_summary）。独立调度保证每次调用有自己的 subrequest 预算。
            console.log('Summary cron fired, generating pending summaries...');
            ctx.waitUntil(generatePendingSummaries(env));
        } else if (event.cron === '0 */6 * * *') {
            // Model-sync cron: 自动刷新 provider_models 目录（/models reconcile +
            // 质量探针 + 证据裁剪）。独立调度（与 fetch/summary cron 分开）保证
            // 每次调用有自己的 subrequest 预算，避免抢爆 50-subrequest 上限。
            console.log('Model-sync cron fired, refreshing model catalog...');
            ctx.waitUntil(refreshModelCatalog(env).then(r =>
                console.log(`Model-sync: reconciled=${r.reconciled.length}, probed=${r.probed.length}, pruned=${r.pruned.length}`)
            ));
        } else {
            console.log(`Unknown cron fired: ${event.cron}`);
        }
        // 记录 cron 触发心跳，供 /api/health/feed 检测调度停摆（best-effort）
        ctx.waitUntil(recordCronHeartbeat(env, event.cron).catch(() => {}));
    },

    async queue(batch: MessageBatch<any>, env: Bindings): Promise<void> {
        await handleNewsQueue(batch, env);
    },

    // Email Routing 入站：digest@slivermoss.site 的退订/回复邮件处理
    async email(message: ForwardableEmailMessage, env: Bindings): Promise<void> {
        await handleInboundEmail(message, env);
    }
};

/** 记录 cron 触发心跳到 cron_heartbeat 表（best-effort，失败不影响主流程） */
async function recordCronHeartbeat(env: Bindings, cron: string): Promise<void> {
    const db = getDb(env);
    await db.run(sql`INSERT OR REPLACE INTO cron_heartbeat (cron_name, last_fired_at) VALUES (${cron}, ${new Date().toISOString()})`);
}

/** 解析 D1 存储的时间戳：兼容 ISO 带 Z 与 "YYYY-MM-DD HH:MM:SS"（无时区后缀按 UTC 处理） */
function parseDbTs(ts: string | number): number {
    if (typeof ts === 'number') return ts;
    const s = String(ts).trim();
    const iso = s.includes('T') ? s : s.replace(' ', 'T');
    const withZone = iso.endsWith('Z') ? iso : `${iso}Z`;
    const ms = new Date(withZone).getTime();
    return Number.isFinite(ms) ? ms : 0;
}

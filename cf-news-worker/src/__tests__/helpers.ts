import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { sql, eq } from 'drizzle-orm';
import { MockD1 } from './mock-d1';
import { getDb } from '../db';
import { clearMemCache } from '../services/cache';
import { newsItems, cronHeartbeat } from '../db/schema';
import { resetStopWordsCache } from '../services/stopWordsCache';
import authRoutes, { verifyJWT } from '../routes/auth';
import newsRoutes from '../routes/news';
import favoritesRoutes from '../routes/favorites';
import historyRoutes from '../routes/history';
import commentsRoutes from '../routes/comments';
import entitiesRoutes from '../routes/entities';
import userRoutes from '../routes/user';
import operationsRoutes from '../routes/operations';
import trendingRoutes from '../routes/trending';
import adminRoutes from '../routes/admin';
import aiRoutes from '../routes/ai';
import {
    FETCH_CRON,
    FETCH_HEARTBEAT_STALE_MINUTES,
    NEWS_STALE_MINUTES,
} from '../cronSchedule';

export const MOCK_ENV: Record<string, any> = {
  JWT_SECRET: 'test-jwt-secret',
  OPENROUTER_API_KEY: 'test-openrouter-key',
  TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
  KV: { get: async () => null, put: async () => {}, delete: async () => {} },
  GLOBAL_RATE_LIMITER: { limit: async () => ({ success: true }) },
  NEWS_QUEUE: { send: async () => {} },
  BROWSER: { fetch: async () => new Response('mock', { status: 200 }) },
  AI: {
    run: async (_model: string, input?: any) => {
      if (input?.text && input?.target_lang) {
        return { translated_text: `translated:${input.text}` };
      }
      if (Array.isArray(input?.text)) {
        return { data: input.text.map(() => [0.1, 0.2, 0.3]) };
      }
      return {
        response: '这是一段足够长的测试 AI 响应内容，用于覆盖摘要、吐槽和趋势分析路径。',
        choices: [{ message: { content: '这是一段足够长的测试 AI 响应内容。' } }],
        results: [{ generated_text: 'mock' }],
      };
    },
  },
  AI_SEARCH: {
    query: async () => ({ results: [] }),
    search: async () => ({ chunks: [] }),
  },
  DB: null as any,
  VECTORIZE: { query: async () => [], upsert: async () => {} },
  R2_IMAGES: {
    get: async () => null,
    put: async () => {},
    delete: async () => {},
    list: async () => ({ objects: [] }),
  },
  PIXABAY_API_KEY: 'test-pixabay-key',
};

/** Build a test Hono app with all routes and mock env */
export function buildTestApp() {
  resetStopWordsCache(); // isolate-level cache would leak stop_words across MockD1 seeds
  const db = new MockD1();
  // 冷热分库：默认附带一个空的归档库 MockD1 —— 现有测试自动覆盖"已绑定、库为空"
  // 的双库读路径（与生产初始态一致）；归档相关测试可通过 archiveDb 注入数据。
  const archiveDb = new MockD1();

  const app = new Hono<{ Bindings: Record<string, any> }>();
  (app as any)._archiveDb = archiveDb;
  app.use('/api/*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }));
  app.route('/api/auth', authRoutes);
  app.route('/api/news', trendingRoutes);
  app.route('/api/news', entitiesRoutes);
  app.route('/api/news', newsRoutes);
  app.route('/api/user/favorites', favoritesRoutes);
  app.route('/api/user/history', historyRoutes);
  app.route('/api/comments', commentsRoutes);
  app.route('/api/user', userRoutes);
  app.route('/api', operationsRoutes);
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
  app.get('/api/health', (c) => c.json({ ok: true }));
  app.get('/api/health/feed', async (c) => {
    const db = getDb(c.env as { DB: D1Database });
    const now = Date.now();
    const problems: string[] = [];

    const parseTs = (ts: string | number | null): number => {
      if (ts === null || ts === undefined) return 0;
      if (typeof ts === 'number') return ts;
      const s = String(ts).trim();
      const iso = s.includes('T') ? s : s.replace(' ', 'T');
      const withZone = iso.endsWith('Z') ? iso : `${iso}Z`;
      const ms = new Date(withZone).getTime();
      return Number.isFinite(ms) ? ms : 0;
    };

    // Mirror production: D1 failure → 503 so monitors can distinguish transient quota errors
    let newsRow;
    try {
      newsRow = await db.select({ ts: newsItems.created_at })
        .from(newsItems).orderBy(sql`created_at DESC`).limit(1).get();
    } catch (e) {
      return c.json({ error: 'D1 unavailable', detail: String(e), timestamp: new Date().toISOString() }, 503);
    }
    const lastNewsMs = parseTs(newsRow?.ts ?? null);
    const newsAgeMin = lastNewsMs ? Math.round((now - lastNewsMs) / 60000) : -1;
    if (newsAgeMin < 0 || newsAgeMin > NEWS_STALE_MINUTES) {
      problems.push(`news_items stale (age=${newsAgeMin}min)`);
    }

    // KV-first heartbeat (cron write path puts cron_hb:{cron} first), D1 fallback on miss
    let hbTs: string | null = null;
    try {
      hbTs = await c.env.KV.get(`cron_hb:${FETCH_CRON}`);
    } catch {
      // KV unavailable — fall through to D1
    }
    if (!hbTs) {
      try {
        const hbRow = await db.select({ ts: cronHeartbeat.last_fired_at })
          .from(cronHeartbeat).where(eq(cronHeartbeat.cron_name, FETCH_CRON)).get();
        hbTs = hbRow?.ts || null;
      } catch (e) {
        return c.json({ error: 'D1 unavailable', detail: String(e), timestamp: new Date().toISOString() }, 503);
      }
    }
    const hbMs = hbTs ? parseTs(hbTs) : 0;
    const hbAgeMin = hbMs ? Math.round((now - hbMs) / 60000) : -1;
    if (hbAgeMin < 0 || hbAgeMin > FETCH_HEARTBEAT_STALE_MINUTES) {
      problems.push(`fetch cron heartbeat stale (age=${hbAgeMin}min)`);
    }

    return c.json({
      ok: problems.length === 0,
      lastNewsAt: newsRow?.ts || null,
      newsAgeMinutes: newsAgeMin,
      lastFetchCronAt: hbTs || null,
      fetchCronAgeMinutes: hbAgeMin,
      problems,
      timestamp: new Date().toISOString(),
    });
  });

  return { app, db, archive: archiveDb };
}

/** Make a JSON request to the test app, returns parsed response */
export async function request(
  app: Hono<{ Bindings: Record<string, any> }>,
  db: MockD1,
  path: string,
  options?: { method?: string; body?: any; headers?: Record<string, string> }
): Promise<{ status: number; body: any; headers: Headers }> {
  // Register/login now require a Turnstile token. Inject a stub token so tests
  // don't need to repeat it; the stub fetch in test files always returns success.
  const requestBody = { ...options?.body };
  if (path === '/api/auth/register' || path === '/api/auth/login') {
    requestBody.turnstileToken = requestBody.turnstileToken ?? 'test-turnstile-token';
  }
  const req = new Request(`http://localhost${path}`, {
    method: options?.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: options?.body ? JSON.stringify(requestBody) : undefined,
  });
  const execCtx = {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
    exports: {},
    tracing: {},
  } as unknown as ExecutionContext;
  // 每个请求清一次进程内 remember 记忆：测试要的是"每次请求如新"，
  // 与生产多 isolate/多 colo 的记忆隔离语义对齐（生产靠 TTL 自然过期）
  clearMemCache();
  const res = await app.fetch(req, { ...MOCK_ENV, DB: db, DB_ARCHIVE: (app as any)._archiveDb ?? null }, execCtx);
  const body: any = await res.clone().json().catch(() => res.text().catch(() => null));
  return { status: res.status, body, headers: res.headers };
}

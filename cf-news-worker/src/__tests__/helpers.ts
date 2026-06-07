import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { MockD1 } from './mock-d1';
import authRoutes from '../routes/auth';
import newsRoutes from '../routes/news';
import favoritesRoutes from '../routes/favorites';
import historyRoutes from '../routes/history';
import commentsRoutes from '../routes/comments';
import userRoutes from '../routes/user';
import operationsRoutes from '../routes/operations';
import trendingRoutes from '../routes/trending';
import adminRoutes from '../routes/admin';
import aiRoutes from '../routes/ai';

export const MOCK_ENV: Record<string, any> = {
  JWT_SECRET: 'test-jwt-secret',
  TURNSTILE_SECRET: '1x0000000000000000000000000000000AA',
  KV: { get: async () => null, put: async () => {}, delete: async () => {} },
  GLOBAL_RATE_LIMITER: { limit: async () => ({ success: true }) },
  QUEUE: { send: async () => {} },
  BROWSER: { fetch: async () => new Response('mock', { status: 200 }) },
  AI: { run: async () => ({ results: [{ generated_text: 'mock' }] }) },
  AI_SEARCH: { query: async () => ({ results: [] }) },
  DB: null as any,
  VECTORIZE: { query: async () => [], upsert: async () => {} },
};

/** Build a test Hono app with all routes and mock env */
export function buildTestApp() {
  const db = new MockD1();

  const app = new Hono<{ Bindings: Record<string, any> }>();
  app.use('/api/*', cors({
    origin: '*',
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
  }));
  app.route('/api/auth', authRoutes);
  app.route('/api/news', newsRoutes);
  app.route('/api/news', trendingRoutes);
  app.route('/api/user/favorites', favoritesRoutes);
  app.route('/api/user/history', historyRoutes);
  app.route('/api/comments', commentsRoutes);
  app.route('/api/user', userRoutes);
  app.route('/api', operationsRoutes);
  app.route('/api/admin', adminRoutes);
  app.route('/api/ai', aiRoutes);
  app.get('/api/health', (c) => c.json({ ok: true }));

  return { app, db };
}

/** Make a JSON request to the test app, returns parsed response */
export async function request(
  app: Hono<{ Bindings: Record<string, any> }>,
  db: MockD1,
  path: string,
  options?: { method?: string; body?: any; headers?: Record<string, string> }
) {
  const req = new Request(`http://localhost${path}`, {
    method: options?.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    body: options?.body ? JSON.stringify(options.body) : undefined,
  });
  const execCtx = { waitUntil: () => {}, passThroughOnException: () => {} };
  const res = await app.fetch(req, { ...MOCK_ENV, DB: db }, execCtx);
  const body = await res.json().catch(() => null);
  return { status: res.status, body, headers: res.headers };
}

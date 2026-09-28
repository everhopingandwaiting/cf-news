import { Hono } from 'hono';
import { Bindings } from '../types';
import { verifyJWT } from './auth';
import { eq, desc, sql, count } from 'drizzle-orm';
import { getDb } from '../db';
import { userReadHistory } from '../db/schema';
import { fetchNewsBundle } from '../services/archive';

const history = new Hono<{ Bindings: Bindings }>();

async function getUserId(c: any): Promise<number | null> {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7);
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    return payload?.sub || null;
}

history.get('/', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const offset = (page - 1) * limit;

    try {
        const db = getDb(c.env);
        // 冷热分库：用户表分页+计数 → 批量水合新闻（主库优先、缺失补归档）
        const histRows = await db.select({
            news_id: userReadHistory.news_id,
            read_at: userReadHistory.read_at,
        })
            .from(userReadHistory)
            .where(eq(userReadHistory.user_id, userId))
            .orderBy(desc(userReadHistory.read_at))
            .limit(limit)
            .offset(offset);

        const bundle = await fetchNewsBundle(c.env, histRows.map(r => r.news_id), {
            withSummary: false, withTake: false,
        });
        const result = histRows
            .filter(r => bundle.has(r.news_id))
            .map(r => ({ ...bundle.get(r.news_id), read_at: r.read_at }));

        const countResult = await db.select({ total: count() })
            .from(userReadHistory)
            .where(eq(userReadHistory.user_id, userId))
            .get();

        const total = countResult?.total || 0;

        return c.json({
            history: result,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    } catch (error) {
        console.error('Error fetching history:', error);
        return c.json({ error: '获取阅读历史失败' }, 500);
    }
});

history.post('/:newsId', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    const newsId = parseInt(c.req.param('newsId'));
    try {
        const db = getDb(c.env);
        await db.insert(userReadHistory).values({ user_id: userId, news_id: newsId }).onConflictDoNothing();
        return c.json({ message: '已标记为已读' });
    } catch (error) {
        console.error('Error marking as read:', error);
        return c.json({ error: '标记失败' }, 500);
    }
});

history.delete('/', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    try {
        const db = getDb(c.env);
        await db.delete(userReadHistory).where(eq(userReadHistory.user_id, userId));
        return c.json({ message: '阅读历史已清空' });
    } catch (error) {
        console.error('Error clearing history:', error);
        return c.json({ error: '清空失败' }, 500);
    }
});

export default history;

import { Hono } from 'hono';
import { Bindings } from '../types';
import { verifyJWT } from './auth';
import { eq, desc, sql, count } from 'drizzle-orm';
import { getDb } from '../db';
import { userReadHistory, newsItems, newsSources } from '../db/schema';

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
        const result = await db.select({
            id: newsItems.id,
            source_id: newsItems.source_id,
            title: newsItems.title,
            url: newsItems.url,
            description: newsItems.description,
            content: newsItems.content,
            image_url: newsItems.image_url,
            category: newsItems.category,
            published_at: newsItems.published_at,
            is_deleted: newsItems.is_deleted,
            created_at: newsItems.created_at,
            source_name: newsSources.name,
            read_at: userReadHistory.read_at,
        })
            .from(userReadHistory)
            .innerJoin(newsItems, eq(userReadHistory.news_id, newsItems.id))
            .leftJoin(newsSources, eq(newsItems.source_id, newsSources.id))
            .where(eq(userReadHistory.user_id, userId))
            .orderBy(desc(userReadHistory.read_at))
            .limit(limit)
            .offset(offset);

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

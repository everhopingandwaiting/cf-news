import { Hono } from 'hono';
import { Bindings } from '../types';
import { verifyJWT } from './auth';

const history = new Hono<{ Bindings: Bindings }>();

async function getUserId(c: any): Promise<number | null> {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7);
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    return payload?.sub || null;
}

// Get read history
history.get('/', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const offset = (page - 1) * limit;

    try {
        const result = await c.env.DB.prepare(`
            SELECT n.*, s.name as source_name, r.read_at
            FROM user_read_history r
            JOIN news_items n ON r.news_id = n.id
            LEFT JOIN news_sources s ON n.source_id = s.id
            WHERE r.user_id = ?
            ORDER BY r.read_at DESC
            LIMIT ? OFFSET ?
        `).bind(userId, limit, offset).all();

        const countResult = await c.env.DB.prepare(
            'SELECT COUNT(*) as total FROM user_read_history WHERE user_id = ?'
        ).bind(userId).first();

        const total = (countResult as any)?.total || 0;

        return c.json({
            history: result.results,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    } catch (error) {
        console.error('Error fetching history:', error);
        return c.json({ error: '获取阅读历史失败' }, 500);
    }
});

// Mark as read
history.post('/:newsId', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    const newsId = parseInt(c.req.param('newsId'));
    try {
        await c.env.DB.prepare(
            'INSERT OR REPLACE INTO user_read_history (user_id, news_id) VALUES (?, ?)'
        ).bind(userId, newsId).run();
        return c.json({ message: '已标记为已读' });
    } catch (error) {
        console.error('Error marking as read:', error);
        return c.json({ error: '标记失败' }, 500);
    }
});

// Clear read history
history.delete('/', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    try {
        await c.env.DB.prepare(
            'DELETE FROM user_read_history WHERE user_id = ?'
        ).bind(userId).run();
        return c.json({ message: '阅读历史已清空' });
    } catch (error) {
        console.error('Error clearing history:', error);
        return c.json({ error: '清空失败' }, 500);
    }
});

export default history;

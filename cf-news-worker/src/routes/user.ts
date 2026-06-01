import { Hono } from 'hono';
import { Bindings } from '../types';
import { verifyJWT } from './auth';
import { getRecommendations } from '../services/recommender';

const user = new Hono<{ Bindings: Bindings }>();

// Middleware to verify JWT and get user ID
async function getUserId(c: any): Promise<number | null> {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }

    const token = authHeader.substring(7);
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    return payload?.sub || null;
}

// Get user favorites
user.get('/favorites', async (c) => {
    const userId = await getUserId(c);
    if (!userId) {
        return c.json({ error: '未授权' }, 401);
    }

    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const offset = (page - 1) * limit;

    try {
        const result = await c.env.DB.prepare(`
            SELECT n.*, s.name as source_name, f.created_at as favorited_at
            FROM user_favorites f
            JOIN news_items n ON f.news_id = n.id
            LEFT JOIN news_sources s ON n.source_id = s.id
            WHERE f.user_id = ?
            ORDER BY f.created_at DESC
            LIMIT ? OFFSET ?
        `).bind(userId, limit, offset).all();

        const countResult = await c.env.DB.prepare(
            'SELECT COUNT(*) as total FROM user_favorites WHERE user_id = ?'
        ).bind(userId).first();

        const total = (countResult as any)?.total || 0;

        return c.json({
            favorites: result.results,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error('Error fetching favorites:', error);
        return c.json({ error: '获取收藏失败' }, 500);
    }
});

user.get('/export', async (c) => {
    const userId = await getUserId(c);
    if (!userId) {
        return c.json({ error: '未授权' }, 401);
    }

    try {
        const result = await c.env.DB.prepare(`
            SELECT n.title, n.url, n.description, ns.summary as ai_summary, s.name as source_name, n.category, n.published_at, f.created_at as favorited_at
            FROM user_favorites f
            JOIN news_items n ON f.news_id = n.id
            LEFT JOIN news_sources s ON n.source_id = s.id
            LEFT JOIN news_summaries ns ON ns.news_id = n.id
            WHERE f.user_id = ? AND f.is_deleted = 0
            ORDER BY f.created_at DESC
        `).bind(userId).all();

        const items = result.results as any[];
        const now = new Date().toISOString().split('T')[0];
        let md = `# 我的收藏\n\n导出时间: ${now} | 共 ${items.length} 条\n\n---\n\n`;

        const categories: Record<string, any[]> = {};
        for (const item of items) {
            const cat = item.category || '未分类';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(item);
        }

        for (const [cat, catItems] of Object.entries(categories)) {
            md += `## ${cat}\n\n`;
            for (const item of catItems) {
                md += `### ${item.title}\n\n`;
                md += `- 来源: ${item.source_name || '未知'}\n`;
                md += `- 链接: ${item.url}\n`;
                if (item.published_at) md += `- 发布: ${item.published_at}\n`;
                md += `- 收藏: ${item.favorited_at}\n`;
                if (item.ai_summary) md += `\n> ${item.ai_summary}\n`;
                md += `\n`;
            }
        }

        return new Response(md, {
            headers: {
                'Content-Type': 'text/markdown; charset=utf-8',
                'Content-Disposition': `attachment; filename="favorites-${now}.md"`,
            },
        });
    } catch (error) {
        console.error('Error exporting favorites:', error);
        return c.json({ error: '导出失败' }, 500);
    }
});

// Add favorite
user.post('/favorites/:newsId', async (c) => {
    const userId = await getUserId(c);
    if (!userId) {
        return c.json({ error: '未授权' }, 401);
    }

    const newsId = parseInt(c.req.param('newsId'));

    try {
        await c.env.DB.prepare(
            'INSERT OR IGNORE INTO user_favorites (user_id, news_id) VALUES (?, ?)'
        ).bind(userId, newsId).run();

        return c.json({ message: '收藏成功' }, 201);
    } catch (error) {
        console.error('Error adding favorite:', error);
        return c.json({ error: '收藏失败' }, 500);
    }
});

// Remove favorite
user.delete('/favorites/:newsId', async (c) => {
    const userId = await getUserId(c);
    if (!userId) {
        return c.json({ error: '未授权' }, 401);
    }

    const newsId = parseInt(c.req.param('newsId'));

    try {
        await c.env.DB.prepare(
            'DELETE FROM user_favorites WHERE user_id = ? AND news_id = ?'
        ).bind(userId, newsId).run();

        return c.json({ message: '取消收藏成功' });
    } catch (error) {
        console.error('Error removing favorite:', error);
        return c.json({ error: '取消收藏失败' }, 500);
    }
});

// Get read history
user.get('/history', async (c) => {
    const userId = await getUserId(c);
    if (!userId) {
        return c.json({ error: '未授权' }, 401);
    }

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
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        console.error('Error fetching history:', error);
        return c.json({ error: '获取阅读历史失败' }, 500);
    }
});

// Mark as read
user.post('/history/:newsId', async (c) => {
    const userId = await getUserId(c);
    if (!userId) {
        return c.json({ error: '未授权' }, 401);
    }

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
user.delete('/history', async (c) => {
    const userId = await getUserId(c);
    if (!userId) {
        return c.json({ error: '未授权' }, 401);
    }

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

user.post('/digest', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    try {
        const existing = await c.env.DB.prepare('SELECT receive_digest FROM user_preferences WHERE user_id = ?').bind(userId).first();
        const newValue = existing?.receive_digest ? 0 : 1;
        await c.env.DB.prepare('INSERT OR REPLACE INTO user_preferences (user_id, receive_digest, updated_at) VALUES (?, ?, datetime("now"))').bind(userId, newValue).run();
        return c.json({ receive_digest: newValue === 1 });
    } catch (error) {
        return c.json({ error: '操作失败' }, 500);
    }
});

user.get('/digest', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    try {
        const pref = await c.env.DB.prepare('SELECT receive_digest FROM user_preferences WHERE user_id = ?').bind(userId).first();
        return c.json({ receive_digest: pref?.receive_digest === 1 });
    } catch {
        return c.json({ receive_digest: false });
    }
});

user.get('/recommendations', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    try {
        const limit = parseInt(c.req.query('limit') || '10');
        const items = await getRecommendations(c.env, userId, limit);
        return c.json({ recommendations: items });
    } catch (error) {
        return c.json({ error: '获取推荐失败' }, 500);
    }
});

// Get user profile
user.get('/profile', async (c) => {
    const userId = await getUserId(c);
    if (!userId) {
        return c.json({ error: '未授权' }, 401);
    }

    try {
        const user = await c.env.DB.prepare(
            'SELECT id, email, username, created_at FROM users WHERE id = ?'
        ).bind(userId).first();

        const stats = await c.env.DB.prepare(`
            SELECT 
                (SELECT COUNT(*) FROM user_favorites WHERE user_id = ?) as favorites_count,
                (SELECT COUNT(*) FROM user_read_history WHERE user_id = ?) as read_count
        `).bind(userId, userId).first();

        return c.json({
            user,
            stats,
        });
    } catch (error) {
        console.error('Error fetching profile:', error);
        return c.json({ error: '获取用户信息失败' }, 500);
    }
});

user.post('/push/subscribe', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);
    try {
        const { endpoint, keys } = await c.req.json();
        if (!endpoint || !keys?.p256dh || !keys?.auth) return c.json({ error: 'Invalid subscription' }, 400);
        await c.env.DB.prepare('INSERT OR REPLACE INTO push_subscriptions (user_id, endpoint, p256dh_key, auth_key) VALUES (?, ?, ?, ?)').bind(userId, endpoint, keys.p256dh, keys.auth).run();
        return c.json({ success: true });
    } catch (error) {
        return c.json({ error: '订阅失败' }, 500);
    }
});

user.delete('/push/unsubscribe', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);
    try {
        const { endpoint } = await c.req.json();
        if (endpoint) {
            await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').bind(userId, endpoint).run();
        } else {
            await c.env.DB.prepare('DELETE FROM push_subscriptions WHERE user_id = ?').bind(userId).run();
        }
        return c.json({ success: true });
    } catch (error) {
        return c.json({ error: '取消订阅失败' }, 500);
    }
});

export default user;
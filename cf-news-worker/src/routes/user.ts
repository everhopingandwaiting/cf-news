import { Hono } from 'hono';
import { Bindings } from '../types';
import { verifyJWT } from './auth';
import { getRecommendations } from '../services/recommender';

const user = new Hono<{ Bindings: Bindings }>();

async function getUserId(c: any): Promise<number | null> {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7);
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    return payload?.sub || null;
}

// Toggle email digest subscription
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

// Get digest subscription status
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

// Get recommendations
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
    if (!userId) return c.json({ error: '未授权' }, 401);

    try {
        const u = await c.env.DB.prepare(
            'SELECT id, email, username, created_at FROM users WHERE id = ?'
        ).bind(userId).first();

        const stats = await c.env.DB.prepare(`
            SELECT 
                (SELECT COUNT(*) FROM user_favorites WHERE user_id = ?) as favorites_count,
                (SELECT COUNT(*) FROM user_read_history WHERE user_id = ?) as read_count
        `).bind(userId, userId).first();

        return c.json({ user: u, stats });
    } catch (error) {
        console.error('Error fetching profile:', error);
        return c.json({ error: '获取用户信息失败' }, 500);
    }
});

// Push notification subscribe
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

// Push notification unsubscribe
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

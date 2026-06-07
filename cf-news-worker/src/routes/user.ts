import { Hono } from 'hono';
import { Bindings } from '../types';
import { verifyJWT } from './auth';
import { getRecommendations } from '../services/recommender';
import { eq, and, or, sql, count } from 'drizzle-orm';
import { getDb } from '../db';
import { userPreferences, pushSubscriptions, users, userFavorites, userReadHistory } from '../db/schema';

const user = new Hono<{ Bindings: Bindings }>();

async function getUserId(c: any): Promise<number | null> {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7);
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    return payload?.sub || null;
}

user.post('/digest', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);
    try {
        const db = getDb(c.env);
        const existing = await db.select({ receive_digest: userPreferences.receive_digest })
            .from(userPreferences)
            .where(eq(userPreferences.user_id, userId))
            .get();
        const newValue = existing?.receive_digest ? 0 : 1;
        await db.insert(userPreferences)
            .values({ user_id: userId, receive_digest: newValue, updated_at: sql`datetime('now')` })
            .onConflictDoUpdate({ target: userPreferences.user_id, set: { receive_digest: newValue, updated_at: sql`datetime('now')` } });
        return c.json({ receive_digest: newValue === 1 });
    } catch (error) {
        return c.json({ error: '操作失败' }, 500);
    }
});

user.get('/digest', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);
    try {
        const db = getDb(c.env);
        const pref = await db.select({ receive_digest: userPreferences.receive_digest })
            .from(userPreferences)
            .where(eq(userPreferences.user_id, userId))
            .get();
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

user.get('/profile', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);
    try {
        const db = getDb(c.env);
        const u = await db.select({
            id: users.id, email: users.email, username: users.username, created_at: users.created_at,
        })
            .from(users)
            .where(eq(users.id, userId))
            .get();

        const favCount = await db.select({ count: count() })
            .from(userFavorites)
            .where(eq(userFavorites.user_id, userId))
            .get();
        const readCount = await db.select({ count: count() })
            .from(userReadHistory)
            .where(eq(userReadHistory.user_id, userId))
            .get();
        const data = { favoritesCount: favCount?.count ?? 0, readCount: readCount?.count ?? 0 };

        return c.json({ user: u, stats: data });
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
        const db = getDb(c.env);
        await db.insert(pushSubscriptions)
            .values({ user_id: userId, endpoint, p256dh_key: keys.p256dh, auth_key: keys.auth })
            .onConflictDoNothing();
        return c.json({ success: true });
    } catch (error) {
        return c.json({ error: '订阅失败' }, 500);
    }
});

user.delete('/push/unsubscribe', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);
    try {
        const db = getDb(c.env);
        const { endpoint } = await c.req.json();
        if (endpoint) {
            await db.delete(pushSubscriptions)
                .where(and(eq(pushSubscriptions.user_id, userId), eq(pushSubscriptions.endpoint, endpoint)));
        } else {
            await db.delete(pushSubscriptions).where(eq(pushSubscriptions.user_id, userId));
        }
        return c.json({ success: true });
    } catch (error) {
        return c.json({ error: '取消订阅失败' }, 500);
    }
});

export default user;

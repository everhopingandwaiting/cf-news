import { Hono } from 'hono';
import { Bindings } from '../types';
import { verifyJWT } from './auth';
import { getRecommendations } from '../services/recommender';
import { eq, and, sql, count, desc } from 'drizzle-orm';
import { getDb } from '../db';
import { userPreferences, pushSubscriptions, users, userFavorites, userReadHistory, userReadLater, userAlertKeywords, newsItems, newsSources, newsSummaries, newsAiTake } from '../db/schema';

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

user.get('/read-later', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);
    const limit = Math.min(parseInt(c.req.query('limit') || '20', 10) || 20, 50);
    try {
        const db = getDb(c.env);
        const rows = await db.select({
            id: newsItems.id,
            source_id: newsItems.source_id,
            title: newsItems.title,
            url: newsItems.url,
            description: newsItems.description,
            image_url: newsItems.image_url,
            category: newsItems.category,
            published_at: newsItems.published_at,
            created_at: newsItems.created_at,
            source_name: newsSources.name,
            ai_summary: newsSummaries.summary,
            ai_take: newsAiTake.take,
            saved_at: userReadLater.created_at,
        })
            .from(userReadLater)
            .innerJoin(newsItems, eq(userReadLater.news_id, newsItems.id))
            .leftJoin(newsSources, eq(newsItems.source_id, newsSources.id))
            .leftJoin(newsSummaries, eq(newsSummaries.news_id, newsItems.id))
            .leftJoin(newsAiTake, eq(newsAiTake.news_id, newsItems.id))
            .where(and(eq(userReadLater.user_id, userId), eq(newsItems.is_deleted, 0)))
            .orderBy(desc(userReadLater.created_at))
            .limit(limit);
        return c.json({ items: rows });
    } catch (error) {
        console.error('read-later list error:', error);
        return c.json({ error: '获取稍后读失败' }, 500);
    }
});

user.post('/read-later/:newsId', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);
    const newsId = parseInt(c.req.param('newsId'), 10);
    if (!Number.isFinite(newsId)) return c.json({ error: 'Invalid news id' }, 400);
    try {
        const db = getDb(c.env);
        await db.insert(userReadLater)
            .values({ user_id: userId, news_id: newsId, created_at: sql`datetime('now')` })
            .onConflictDoNothing();
        return c.json({ message: '已加入稍后读' }, 201);
    } catch (error) {
        console.error('read-later add error:', error);
        return c.json({ error: '加入稍后读失败' }, 500);
    }
});

user.delete('/read-later/:newsId', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);
    const newsId = parseInt(c.req.param('newsId'), 10);
    if (!Number.isFinite(newsId)) return c.json({ error: 'Invalid news id' }, 400);
    try {
        const db = getDb(c.env);
        await db.delete(userReadLater).where(and(eq(userReadLater.user_id, userId), eq(userReadLater.news_id, newsId)));
        return c.json({ message: '已移出稍后读' });
    } catch (error) {
        console.error('read-later delete error:', error);
        return c.json({ error: '移出稍后读失败' }, 500);
    }
});

user.get('/radar', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);
    const hours = Math.min(parseInt(c.req.query('hours') || '24', 10) || 24, 168);
    try {
        const db = getDb(c.env);
        const keywords = await db.select({
            id: userAlertKeywords.id,
            keyword: userAlertKeywords.keyword,
            created_at: userAlertKeywords.created_at,
        })
            .from(userAlertKeywords)
            .where(eq(userAlertKeywords.user_id, userId))
            .orderBy(desc(userAlertKeywords.created_at))
            .all();

        const alerts = [];
        for (const keyword of keywords.slice(0, 20)) {
            const escaped = keyword.keyword.replace(/[%_\\]/g, '\\$&');
            const articles = await db.all<any>(sql`
                SELECT n.id, n.source_id, n.title, n.url, n.description, n.image_url, n.category,
                       n.published_at, n.created_at, s.name as source_name, s.language as source_lang,
                       ns.summary as ai_summary, nt.take as ai_take
                FROM news_items n
                LEFT JOIN news_sources s ON n.source_id = s.id
                LEFT JOIN news_summaries ns ON ns.news_id = n.id
                LEFT JOIN news_ai_take nt ON nt.news_id = n.id
                WHERE n.is_deleted = 0
                  AND n.created_at >= datetime('now', '-' || ${hours} || ' hours')
                  AND (n.title LIKE ${'%' + escaped + '%'} ESCAPE '\\' OR n.description LIKE ${'%' + escaped + '%'} ESCAPE '\\')
                ORDER BY COALESCE(n.published_at, n.created_at) DESC
                LIMIT 5
            `);
            alerts.push({ ...keyword, count: articles.length, articles });
        }
        return c.json({ keywords, alerts });
    } catch (error) {
        console.error('radar list error:', error);
        return c.json({ error: '获取新闻雷达失败' }, 500);
    }
});

user.post('/radar', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);
    try {
        const { keyword } = await c.req.json<{ keyword?: string }>();
        const value = (keyword || '').trim().replace(/\s+/g, ' ').slice(0, 60);
        if (value.length < 2) return c.json({ error: '关键词至少 2 个字符' }, 400);
        const db = getDb(c.env);
        await db.insert(userAlertKeywords)
            .values({ user_id: userId, keyword: value, created_at: sql`datetime('now')` })
            .onConflictDoNothing();
        return c.json({ keyword: value }, 201);
    } catch (error) {
        console.error('radar add error:', error);
        return c.json({ error: '添加新闻雷达失败' }, 500);
    }
});

user.delete('/radar/:keyword', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);
    const keyword = decodeURIComponent(c.req.param('keyword')).trim();
    try {
        const db = getDb(c.env);
        await db.delete(userAlertKeywords).where(and(eq(userAlertKeywords.user_id, userId), eq(userAlertKeywords.keyword, keyword)));
        return c.json({ message: '已删除新闻雷达关键词' });
    } catch (error) {
        console.error('radar delete error:', error);
        return c.json({ error: '删除新闻雷达失败' }, 500);
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

import { Hono } from 'hono';
import { Bindings } from '../types';
import { eq, and, desc, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { newsComments, users } from '../db/schema';
import { verifyJWT } from './auth';

const comments = new Hono<{ Bindings: Bindings }>();

const MAX_COMMENT_LENGTH = 5000;

comments.get('/:newsId', async (c) => {
    const newsId = parseInt(c.req.param('newsId'));
    const db = getDb(c.env);
    const result = await db.select({
        id: newsComments.id,
        news_id: newsComments.news_id,
        user_id: newsComments.user_id,
        content: newsComments.content,
        is_deleted: newsComments.is_deleted,
        created_at: newsComments.created_at,
        username: users.username,
    })
        .from(newsComments)
        .innerJoin(users, eq(newsComments.user_id, users.id))
        .where(and(eq(newsComments.news_id, newsId), eq(newsComments.is_deleted, 0)))
        .orderBy(desc(newsComments.created_at));
    return c.json({ comments: result });
});

comments.post('/:newsId', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return c.json({ error: 'Unauthorized' }, 401);

    try {
        const token = authHeader.replace('Bearer ', '');
        const payload = await verifyJWT(token, c.env.JWT_SECRET);
        if (!payload) return c.json({ error: 'Invalid token' }, 401);

        const newsId = parseInt(c.req.param('newsId'));
        const { content } = await c.req.json();

        if (!content || content.trim().length === 0) {
            return c.json({ error: 'Content required' }, 400);
        }
        if (content.length > MAX_COMMENT_LENGTH) {
            return c.json({ error: 'Content too long' }, 400);
        }

        const db = getDb(c.env);
        await db.insert(newsComments).values({
            news_id: newsId,
            user_id: payload.sub,
            content,
            created_at: sql`datetime('now', '+8 hours')`,
        });

        return c.json({ success: true });
    } catch (e) {
        console.error('Comment error:', e);
        return c.json({ error: 'Invalid token' }, 401);
    }
});

comments.delete('/:commentId', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return c.json({ error: 'Unauthorized' }, 401);

    try {
        const token = authHeader.replace('Bearer ', '');
        const payload = await verifyJWT(token, c.env.JWT_SECRET);
        if (!payload) return c.json({ error: 'Invalid token' }, 401);
        const commentId = parseInt(c.req.param('commentId'));

        const db = getDb(c.env);
        await db.update(newsComments)
            .set({ is_deleted: 1, deleted_at: sql`datetime('now', '+8 hours')` })
            .where(and(
                eq(newsComments.id, commentId),
                eq(newsComments.user_id, payload.sub),
                eq(newsComments.is_deleted, 0)
            ));

        return c.json({ success: true });
    } catch {
        return c.json({ error: 'Invalid token' }, 401);
    }
});

export default comments;

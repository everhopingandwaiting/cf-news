import { Hono } from 'hono';
import { asc, eq } from 'drizzle-orm';
import { Bindings } from '../types';
import { getDb } from '../db';
import { newsEntities } from '../db/schema';

const entities = new Hono<{ Bindings: Bindings }>();

entities.get('/:id/entities', async (c) => {
    const newsId = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(newsId)) return c.json({ error: 'Invalid news id' }, 400);

    const db = getDb(c.env);
    const rows = await db.select({
        type: newsEntities.entity_type,
        value: newsEntities.entity_value,
        context: newsEntities.entity_context,
    })
        .from(newsEntities)
        .where(eq(newsEntities.news_id, newsId))
        .orderBy(asc(newsEntities.id));

    return c.json({ entities: rows });
});

export default entities;

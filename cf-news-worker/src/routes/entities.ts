import { Hono } from 'hono';
import { asc, eq } from 'drizzle-orm';
import { Bindings } from '../types';
import { getDb, getArchiveDb, type DbClient } from '../db';
import { newsEntities } from '../db/schema';

const entities = new Hono<{ Bindings: Bindings }>();

entities.get('/:id/entities', async (c) => {
    const newsId = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(newsId)) return c.json({ error: 'Invalid news id' }, 400);

    const db = getDb(c.env);
    const query = (target: DbClient) => target.select({
        type: newsEntities.entity_type,
        value: newsEntities.entity_value,
        context: newsEntities.entity_context,
    })
        .from(newsEntities)
        .where(eq(newsEntities.news_id, newsId))
        .orderBy(asc(newsEntities.id));

    let rows = await query(db);
    if (rows.length === 0) {
        // 冷热分库：主库无命中 → 查归档侧（热文无实体时这里也只是一次空查询）
        const arch = getArchiveDb(c.env);
        if (arch) rows = await query(arch);
    }

    return c.json({ entities: rows });
});

export default entities;

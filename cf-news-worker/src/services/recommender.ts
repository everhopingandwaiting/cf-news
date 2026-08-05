import { Bindings } from '../types';
import { eq, sql, and, desc, not, inArray } from 'drizzle-orm';
import { getDb } from '../db';
import { newsItems, newsSources, userReadHistory } from '../db/schema';

export async function getRecommendations(env: Bindings, userId: number, limit = 10): Promise<any[]> {
    const db = getDb(env);
    const prefs = await db.all<{ category: string; cnt: number }>(sql`
        SELECT n.category, COUNT(*) as cnt
        FROM user_read_history h
        JOIN news_items n ON h.news_id = n.id
        WHERE h.user_id = ${userId}
        GROUP BY n.category
        ORDER BY cnt DESC
        LIMIT 3
    `);

    const categories = prefs.map(p => p.category);
    if (categories.length === 0) {
        return db.all<any>(sql`
            SELECT n.*, s.name as source_name
            FROM news_items n
            LEFT JOIN news_sources s ON n.source_id = s.id
            WHERE n.is_deleted = 0
            ORDER BY n.created_at DESC
            LIMIT ${limit}
        `);
    }

    return db.all<any>(sql`
        SELECT n.*, s.name as source_name
        FROM news_items n
        LEFT JOIN news_sources s ON n.source_id = s.id
        WHERE n.is_deleted = 0
        AND n.category IN (${categories.map(c => `'${c.replace(/'/g, "''")}'`).join(',')})
        AND n.id NOT IN (SELECT news_id FROM user_read_history WHERE user_id = ${userId})
        ORDER BY n.created_at DESC
        LIMIT ${limit}
    `);
}

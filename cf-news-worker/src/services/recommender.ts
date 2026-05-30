import { Bindings } from '../types';

export async function getRecommendations(env: Bindings, userId: number, limit = 10): Promise<any[]> {
    const prefs = await env.DB.prepare(`
        SELECT n.category, COUNT(*) as cnt
        FROM user_read_history h
        JOIN news_items n ON h.news_id = n.id
        WHERE h.user_id = ?
        GROUP BY n.category
        ORDER BY cnt DESC
        LIMIT 3
    `).bind(userId).all<{ category: string; cnt: number }>();

    const categories = prefs.results.map(p => p.category);
    if (categories.length === 0) {
        return (await env.DB.prepare(`
            SELECT n.*, s.name as source_name
            FROM news_items n
            LEFT JOIN news_sources s ON n.source_id = s.id
            WHERE n.is_deleted = 0
            ORDER BY n.created_at DESC
            LIMIT ?
        `).bind(limit).all()).results;
    }

    const placeholders = categories.map(() => '?').join(',');
    return (await env.DB.prepare(`
        SELECT n.*, s.name as source_name
        FROM news_items n
        LEFT JOIN news_sources s ON n.source_id = s.id
        WHERE n.is_deleted = 0
        AND n.category IN (${placeholders})
        AND n.id NOT IN (SELECT news_id FROM user_read_history WHERE user_id = ?)
        ORDER BY n.created_at DESC
        LIMIT ?
    `).bind(...categories, userId, limit).all()).results;
}

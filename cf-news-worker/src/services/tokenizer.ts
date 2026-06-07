import { Bindings } from '../types';
import { sql } from 'drizzle-orm';
import { getDb } from '../db';

/**
 * Index a news item into D1 FTS5 full-text search table.
 */
export async function indexNewsItem(env: Bindings, id: number, title: string, description?: string): Promise<void> {
    const db = getDb(env);
    try {
        await db.run(sql`INSERT OR IGNORE INTO news_fts(rowid, title, description) VALUES (${id}, ${title}, ${description || ''})`);
    } catch (e) {
        console.error(`FTS5 index failed for id=${id}:`, e);
    }
}

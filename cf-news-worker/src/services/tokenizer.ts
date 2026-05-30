import { Bindings } from '../types';

/**
 * Index a news item into D1 FTS5 full-text search table.
 * Replaces the old KV-based keyword index (which exceeded free-tier KV write quota).
 */
export async function indexNewsItem(env: Bindings, id: number, title: string, description?: string): Promise<void> {
    try {
        await env.DB.prepare(
            'INSERT OR IGNORE INTO news_fts(rowid, title, description) VALUES (?, ?, ?)'
        ).bind(id, title, description || '').run();
    } catch (e) {
        console.error(`FTS5 index failed for id=${id}:`, e);
    }
}

import { Hono } from 'hono';
import { Bindings } from '../types';
import { indexNewsItem } from '../services/tokenizer';
import { fetchSourceNews } from '../services/newsFetcher';
import { storeDedupHash } from '../services/dedup';

const admin = new Hono<{ Bindings: Bindings }>();

admin.get('/sources', async (c) => {
    const sources = await c.env.DB.prepare(
        `SELECT ns.*,
          (SELECT COUNT(*) FROM news_items ni
           WHERE ni.source_id = ns.id
             AND ni.created_at >= datetime('now', '+8 hours', 'start of day')
          ) as today_count
         FROM news_sources ns ORDER BY sort_order, language, name`
    ).all();
    return c.json({ sources: sources.results });
});

admin.post('/sources', async (c) => {
    const { name, url, feed_url, category, language } = await c.req.json();
    if (!name || !feed_url) {
        return c.json({ error: '名称和订阅地址必填' }, 400);
    }
    const result = await c.env.DB.prepare(
        'INSERT INTO news_sources (name, url, feed_url, category, language) VALUES (?, ?, ?, ?, ?)'
    ).bind(name, url || '', feed_url, category || 'news', language || 'zh').run();
    return c.json({ success: true, id: result.meta.last_row_id }, 201);
});

admin.put('/sources/:id', async (c) => {
    const id = parseInt(c.req.param('id'));
    const { name, url, feed_url, category, language, enabled, sort_order } = await c.req.json();
    await c.env.DB.prepare(
        'UPDATE news_sources SET name=?, url=?, feed_url=?, category=?, language=?, enabled=?, sort_order=? WHERE id=?'
    ).bind(
        name, url || '', feed_url,
        category || 'news', language || 'zh',
        enabled !== undefined ? (enabled ? 1 : 0) : 1,
        sort_order !== undefined ? sort_order : 99, id
    ).run();
    return c.json({ success: true });
});

admin.delete('/sources/:id', async (c) => {
    const id = parseInt(c.req.param('id'));
    await c.env.DB.prepare('DELETE FROM news_sources WHERE id = ?').bind(id).run();
    return c.json({ success: true });
});

admin.post('/sources/:id/test', async (c) => {
    const id = parseInt(c.req.param('id'));
    const source = await c.env.DB.prepare(
        'SELECT * FROM news_sources WHERE id = ?'
    ).bind(id).first<{ feed_url: string }>();
    if (!source) return c.json({ error: '源不存在' }, 404);
    try {
        const res = await fetch(source.feed_url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CFNewsTest/1.0)' } });
        const text = await res.text();
        const items = (text.match(/<item[^>]*>[\s\S]*?<\/item>/gi) || []).length;
        return c.json({ success: true, status: res.status, items, feed_type: text.includes('<rss') ? 'RSS' : text.includes('<feed') ? 'Atom' : 'Unknown' });
    } catch (e: any) {
        return c.json({ success: false, error: String(e) }, 500);
    }
});

admin.post('/sources/dedup', async (c) => {
    try {
        const dupes = await c.env.DB.prepare(
            `SELECT feed_url, MIN(id) as keep_id FROM news_sources GROUP BY feed_url HAVING COUNT(*) > 1`
        ).all();
        let totalDeleted = 0;
        for (const row of (dupes.results as any[])) {
            const dupRows = await c.env.DB.prepare(
                `SELECT id FROM news_sources WHERE feed_url = ? AND id != ?`
            ).bind(row.feed_url, row.keep_id).all();
            for (const dup of (dupRows.results as any[])) {
                await c.env.DB.prepare(`UPDATE news_items SET source_id = ? WHERE source_id = ?`).bind(row.keep_id, dup.id).run();
                await c.env.DB.prepare(`DELETE FROM news_sources WHERE id = ?`).bind(dup.id).run();
                totalDeleted++;
            }
        }
        try {
            await c.env.DB.prepare(`CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_feed_url ON news_sources(feed_url)`).run();
        } catch {}
        return c.json({ success: true, deleted: totalDeleted });
    } catch (e: any) {
        return c.json({ success: false, error: String(e) }, 500);
    }
});

// Fetch a single source immediately
admin.post('/sources/:id/fetch', async (c) => {
    const id = parseInt(c.req.param('id'));
    try {
        const saved = await fetchSourceNews(c.env, id);
        return c.json({ success: true, saved });
    } catch (e: any) {
        return c.json({ success: false, error: String(e) }, 500);
    }
});

// Rebuild FTS5 search index from all existing news items (async, runs in background)
admin.post('/rebuild-index', async (c) => {
    c.executionCtx.waitUntil((async () => {
        try {
            // Batch rebuild: clear FTS5 table and re-insert all active items
            await c.env.DB.prepare('DELETE FROM news_fts').run();
            const result = await c.env.DB.prepare(
                "INSERT INTO news_fts(rowid, title, description) SELECT id, title, COALESCE(description, '') FROM news_items WHERE is_deleted = 0"
            ).run();
            console.log(`FTS5 index rebuild complete: ${result.meta.changes || 0} items`);
        } catch (e) {
            console.error('FTS5 index rebuild failed:', e);
        }
    })());
    return c.json({ success: true, message: 'FTS5 index rebuild started in background' });
});

// Backfill Vectorize embeddings for existing news items
admin.post('/backfill-vectors', async (c) => {
    c.executionCtx.waitUntil((async () => {
        try {
            const items = await c.env.DB.prepare(
                'SELECT id, title, description FROM news_items WHERE is_deleted = 0 ORDER BY id DESC LIMIT 500'
            ).all<{ id: number; title: string; description: string | null }>();
            let stored = 0;
            let failed = 0;
            for (const item of items.results) {
                try {
                    await storeDedupHash(c.env, item.id, item.title, item.description || undefined);
                    stored++;
                } catch (e) {
                    failed++;
                    console.error(`Vector store failed for id=${item.id}:`, e);
                }
            }
            console.log(`Vector backfill complete: ${stored} stored, ${failed} failed`);
        } catch (e) {
            console.error('Vector backfill failed:', e);
        }
    })());
    return c.json({ success: true, message: 'Vector backfill started in background (500 items)' });
});

export default admin;

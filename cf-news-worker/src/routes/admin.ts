import { Hono } from 'hono';
import { Bindings } from '../types';
import { indexNewsItem } from '../services/tokenizer';
import { fetchSourceNews } from '../services/newsFetcher';
import { storeDedupHash } from '../services/dedup';
import { eq, desc, sql, and, ne } from 'drizzle-orm';
import { getDb } from '../db';
import { newsSources, newsItems, newsFts } from '../db/schema';

const admin = new Hono<{ Bindings: Bindings }>();

admin.get('/sources', async (c) => {
    const db = getDb(c.env);
    const sources = await db.select({
        id: newsSources.id,
        name: newsSources.name,
        url: newsSources.url,
        feed_url: newsSources.feed_url,
        category: newsSources.category,
        language: newsSources.language,
        source_type: newsSources.source_type,
        enabled: newsSources.enabled,
        sort_order: newsSources.sort_order,
        last_fetched_at: newsSources.last_fetched_at,
        last_fetched_count: newsSources.last_fetched_count,
        error_count: newsSources.error_count,
        today_count: sql<number>`(
            SELECT COUNT(*) FROM news_items ni
            WHERE ni.source_id = news_sources.id
              AND ni.created_at >= datetime('now', '+8 hours', 'start of day')
        )`,
    }).from(newsSources)
        .orderBy(newsSources.sort_order, newsSources.language, newsSources.name)
        .all();
    return c.json({ sources });
});

admin.post('/sources', async (c) => {
    const { name, url, feed_url, category, language } = await c.req.json();
    if (!name || !feed_url) {
        return c.json({ error: '名称和订阅地址必填' }, 400);
    }
    const db = getDb(c.env);
    await db.insert(newsSources).values({
        name, url: url || '', feed_url,
        category: category || 'news', language: language || 'zh',
    });
    const created = await db.select({ id: newsSources.id })
        .from(newsSources)
        .where(eq(newsSources.feed_url, feed_url))
        .orderBy(desc(newsSources.id))
        .limit(1)
        .get();
    return c.json({ success: true, id: created?.id }, 201);
});

admin.put('/sources/:id', async (c) => {
    const id = parseInt(c.req.param('id'));
    const { name, url, feed_url, category, language, enabled, sort_order } = await c.req.json();
    const db = getDb(c.env);
    await db.update(newsSources).set({
        name, url: url || '', feed_url,
        category: category || 'news', language: language || 'zh',
        enabled: enabled !== undefined ? (enabled ? 1 : 0) : 1,
        sort_order: sort_order !== undefined ? sort_order : 99,
    }).where(eq(newsSources.id, id));
    return c.json({ success: true });
});

admin.delete('/sources/:id', async (c) => {
    const id = parseInt(c.req.param('id'));
    const db = getDb(c.env);
    await db.delete(newsSources).where(eq(newsSources.id, id));
    return c.json({ success: true });
});

admin.post('/sources/:id/test', async (c) => {
    const id = parseInt(c.req.param('id'));
    const db = getDb(c.env);
    const source = await db.select({ feed_url: newsSources.feed_url })
        .from(newsSources)
        .where(eq(newsSources.id, id))
        .get();
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
    const db = getDb(c.env);
    try {
        // Find duplicate feed_urls — keep the lowest id
        const dupes = await db.select({
            feed_url: newsSources.feed_url,
            keepId: sql<number>`MIN(id)`,
        }).from(newsSources)
            .groupBy(newsSources.feed_url)
            .having(sql`COUNT(*) > 1`)
            .all();

        let totalDeleted = 0;
        for (const row of dupes) {
            const dupRows = await db.select({ id: newsSources.id })
                .from(newsSources)
                .where(and(
                    eq(newsSources.feed_url, row.feed_url),
                    ne(newsSources.id, row.keepId),
                ))
                .all();
            for (const dup of dupRows) {
                await db.update(newsItems)
                    .set({ source_id: row.keepId })
                    .where(eq(newsItems.source_id, dup.id));
                await db.delete(newsSources).where(eq(newsSources.id, dup.id));
                totalDeleted++;
            }
        }
        try {
            await db.run(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_feed_url ON news_sources(feed_url)`);
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

// Debug: fetch any URL from Workers network (admin only)
admin.get('/debug/fetch', async (c) => {
    const targetUrl = c.req.query('url');
    if (!targetUrl) return c.json({ error: 'Missing ?url=' }, 400);

    let parsed: URL;
    try { parsed = new URL(targetUrl); } catch {
        return c.json({ error: 'Invalid URL' }, 400);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return c.json({ error: 'Only http/https supported' }, 400);
    }

    try {
        const t0 = Date.now();
        const res = await fetch(targetUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CFNewsDebug/1.0)' },
            signal: AbortSignal.timeout(15_000),
        });
        const ms = Date.now() - t0;
        const text = await res.text();
        const items = (text.match(/<item[^>]*>[\s\S]*?<\/item>/gi) || []).length;
        return c.json({
            url: targetUrl,
            status: res.status,
            ms,
            bytes: text.length,
            content_type: res.headers.get('Content-Type') || '',
            feed_type: text.includes('<rss') ? 'RSS' : text.includes('<feed') ? 'Atom' : 'Unknown',
            item_count: items,
            body_preview: text.slice(0, 300),
        });
    } catch (e: any) {
        return c.json({ url: targetUrl, error: e.message }, 502);
    }
});

// Rebuild FTS5 search index from all existing news items (async, runs in background)
admin.post('/rebuild-index', async (c) => {
    const db = getDb(c.env);
    c.executionCtx.waitUntil((async () => {
        try {
            await db.run(sql`DELETE FROM news_fts`);
            const result = await db.run(sql`
                INSERT INTO news_fts(rowid, title, description)
                SELECT id, title, COALESCE(description, '') FROM news_items WHERE is_deleted = 0
            `);
            console.log(`FTS5 index rebuild complete: ${result.meta.changes || 0} items`);
        } catch (e) {
            console.error('FTS5 index rebuild failed:', e);
        }
    })());
    return c.json({ success: true, message: 'FTS5 index rebuild started in background' });
});

// Backfill Vectorize embeddings for existing news items
admin.post('/backfill-vectors', async (c) => {
    const db = getDb(c.env);
    c.executionCtx.waitUntil((async () => {
        try {
            const items = await db.select({
                id: newsItems.id, title: newsItems.title, description: newsItems.description,
            }).from(newsItems)
                .where(eq(newsItems.is_deleted, 0))
                .orderBy(desc(newsItems.id))
                .limit(500)
                .all();
            let stored = 0;
            let failed = 0;
            for (const item of items) {
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

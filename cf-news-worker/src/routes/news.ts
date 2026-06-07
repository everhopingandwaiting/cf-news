import { Hono } from 'hono';
import { Bindings, NewsItem } from '../types';
import { generatePerspectives } from '../services/summarizer';
import { eq, sql, and, count, desc, like, SQL } from 'drizzle-orm';
import { getDb } from '../db';
import { newsItems, newsSources, newsSummaries, newsAiTake, newsComments, newsFts } from '../db/schema';

const news = new Hono<{ Bindings: Bindings }>();

async function searchNewsFTS(env: Bindings, query: string): Promise<number[] | null> {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return null;
    const sanitized = normalized.replace(/[^\w\u4e00-\u9fff\s-]/g, ' ').trim();
    if (!sanitized) return null;
    const hasCJK = /[\u4e00-\u9fff]/.test(sanitized);
    if (hasCJK) return null;

    let ids: number[] = [];
    try {
        const ftsQuery = sanitized.split(/\s+/).map(w => w + '*').join(' ');
        const db = getDb(env);
        const result = await db.all<{ rowid: number }>(
            sql`SELECT rowid FROM news_fts WHERE news_fts MATCH ${ftsQuery} LIMIT 200`
        );
        ids = result.map(r => r.rowid);
    } catch (e) {
        console.error('FTS5 search error:', e);
        return null;
    }
    return ids.length > 0 ? ids : null;
}

news.get('/', async (c) => {
    const cacheVer = await c.env.KV.get('news_cache_ver').catch(() => null) || '0';
    const cacheKey = new Request(c.req.url + '&_cv=' + cacheVer, { headers: { 'Accept': 'application/json' } });
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const category = c.req.query('category');
    const search = c.req.query('search');
    const sourceId = c.req.query('source_id');
    const lang = c.req.query('lang');
    const hasSummary = c.req.query('has_summary');
    const offset = (page - 1) * limit;

    const db = getDb(c.env);

    const conds: SQL[] = [sql`n.is_deleted = 0`];

    if (hasSummary === '1') {
        conds.push(sql`ns.id IS NOT NULL`);
    } else if (hasSummary === '0') {
        conds.push(sql`ns.id IS NULL`);
    }

    if (category && category !== 'all') {
        conds.push(sql`n.category = ${category}`);
    }

    if (sourceId) {
        conds.push(sql`n.source_id = ${parseInt(sourceId)}`);
    }

    if (lang) {
        conds.push(sql`s.language = ${lang}`);
    }

    if (search) {
        const indexedIds = await searchNewsFTS(c.env, search);
        if (indexedIds && indexedIds.length > 0) {
            conds.push(sql`n.id IN (${sql.join(indexedIds.map(id => sql`${id}`))})`);
        } else {
            const escaped = search.replace(/[%_\\]/g, '\\$&');
            conds.push(sql`n.title LIKE ${'%' + escaped + '%'} ESCAPE '\\'`);
        }
    }

    const whereClause = sql.join(conds, sql` AND `);

    try {
        const countResult = await db.all<{ total: number }>(sql`
            SELECT COUNT(*) as total
            FROM news_items n
            LEFT JOIN news_sources s ON n.source_id = s.id
            LEFT JOIN news_summaries ns ON ns.news_id = n.id
            LEFT JOIN news_ai_take nt ON nt.news_id = n.id
            WHERE ${whereClause}
        `);
        const total = countResult[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        const newsData = await db.all<any>(sql`
            SELECT n.*, s.name as source_name, s.language as source_lang,
                   (SELECT COUNT(*) FROM news_comments nc WHERE nc.news_id = n.id AND nc.is_deleted = 0) as comments_count,
                   ns.summary as ai_summary, nt.take as ai_take
            FROM news_items n
            LEFT JOIN news_sources s ON n.source_id = s.id
            LEFT JOIN news_summaries ns ON ns.news_id = n.id
            LEFT JOIN news_ai_take nt ON nt.news_id = n.id
            WHERE ${whereClause}
            ORDER BY COALESCE(n.published_at, n.created_at) DESC
            LIMIT ${limit} OFFSET ${offset}
        `);

        const result = {
            news: newsData,
            pagination: { page, limit, total, totalPages, hasMore: page < totalPages },
        };

        const response = c.json(result);
        if (!search) {
            response.headers.set('Cache-Control', 'public, max-age=60, s-maxage=60');
            c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
        }
        return response;
    } catch (error) {
        console.error('Error fetching news:', error);
        return c.json({ error: '获取新闻失败' }, 500);
    }
});

news.get('/:id', async (c) => {
    const id = c.req.param('id');
    const db = getDb(c.env);
    try {
        const item = await db.all<any>(sql`
            SELECT n.*, s.name as source_name, s.language as source_lang,
                   ns.summary as ai_summary, nt.take as ai_take
            FROM news_items n
            LEFT JOIN news_sources s ON n.source_id = s.id
            LEFT JOIN news_summaries ns ON ns.news_id = n.id
            LEFT JOIN news_ai_take nt ON nt.news_id = n.id
            WHERE n.id = ${id}
        `);
        if (!item || item.length === 0) {
            return c.json({ error: '新闻不存在' }, 404);
        }
        return c.json({ news: item[0] });
    } catch (error) {
        console.error('Error fetching news item:', error);
        return c.json({ error: '获取新闻详情失败' }, 500);
    }
});

news.get('/:id/perspectives', async (c) => {
    const id = parseInt(c.req.param('id'));
    try {
        const result = await generatePerspectives(c.env, id);
        if (!result) return c.json({ error: '暂无多视角数据' }, 404);
        return c.json(result);
    } catch (error) {
        console.error('Error generating perspectives:', error);
        return c.json({ error: '生成多视角对比失败' }, 500);
    }
});

news.get('/sources/list', async (c) => {
    const db = getDb(c.env);
    try {
        const rows = await db.select({
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
        })
            .from(newsSources)
            .orderBy(newsSources.sort_order, newsSources.language, newsSources.name)
            .all();
        return c.json({ sources: rows });
    } catch (error) {
        console.error('Error fetching sources:', error);
        return c.json({ error: '获取新闻源失败' }, 500);
    }
});

news.get('/categories/list', async (c) => {
    const db = getDb(c.env);
    try {
        const categories = await db.all<{ category: string; count: number }>(sql`
            SELECT category, COUNT(*) as count
            FROM news_items
            GROUP BY category
            ORDER BY count DESC
        `);
        return c.json({ categories });
    } catch (error) {
        console.error('Error fetching categories:', error);
        return c.json({ error: '获取分类失败' }, 500);
    }
});

news.get('/:id/content', async (c) => {
    const id = parseInt(c.req.param('id'));
    const db = getDb(c.env);
    try {
        const item = await db.select({
            id: newsItems.id, title: newsItems.title, url: newsItems.url,
            content: newsItems.content, description: newsItems.description,
        }).from(newsItems)
            .where(and(eq(newsItems.id, id), eq(newsItems.is_deleted, 0)))
            .get();

        if (!item) return c.json({ error: '新闻不存在' }, 404);

        if (item.content && item.content.length > 500) {
            return c.json({ content: item.content });
        }

        const { fetchRichArticleContent } = await import('../services/contentFetcher');
        const rich = await fetchRichArticleContent(item.url);
        if (rich) {
            await db.update(newsItems)
                .set({ content: rich.html })
                .where(eq(newsItems.id, item.id));
            return c.json({ content: rich.html || rich.text });
        }

        return c.json({ content: item.description || item.content || '' });
    } catch (error) {
        console.error('Error fetching article content:', error);
        return c.json({ error: '获取文章内容失败' }, 500);
    }
});

export default news;

import { Hono } from 'hono';
import { Bindings, NewsItem } from '../types';
import { generatePerspectives } from '../services/summarizer';

const news = new Hono<{ Bindings: Bindings }>();

const SEARCH_CACHE_PREFIX = 'search_cache:';
const SEARCH_CACHE_TTL = 300; // 5 minutes

async function searchNewsFTS(env: Bindings, query: string): Promise<number[] | null> {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return null;

    // Try KV hot cache first
    const cacheKey = SEARCH_CACHE_PREFIX + normalized;
    try {
        const cached = await env.KV.get(cacheKey);
        if (cached) {
            const ids = JSON.parse(cached);
            if (Array.isArray(ids)) return ids;
        }
    } catch {}

    // Sanitize FTS5 query — strip special chars, keep alphanumeric, CJK, spaces, hyphens
    const sanitized = normalized.replace(/[^\w\u4e00-\u9fff\s-]/g, ' ').trim();
    if (!sanitized) return null;

    let ids: number[] = [];
    try {
        // Wrap each word with FTS5 prefix match for fuzzy search
        const ftsQuery = sanitized.split(/\s+/).map(w => w + '*').join(' ');
        const result = await env.DB.prepare(
            'SELECT rowid FROM news_fts WHERE news_fts MATCH ? LIMIT 200'
        ).bind(ftsQuery).all<{ rowid: number }>();
        ids = result.results.map(r => r.rowid);
    } catch (e) {
        console.error('FTS5 search error:', e);
        // Fallback: LIKE search
        return null;
    }

    // Cache results in KV (only non-empty, with short TTL)
    if (ids.length > 0) {
        env.KV.put(cacheKey, JSON.stringify(ids), { expirationTtl: SEARCH_CACHE_TTL }).catch(() => {});
    }

    return ids.length > 0 ? ids : null;
}

news.get('/', async (c) => {
    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const category = c.req.query('category');
    const search = c.req.query('search');
    const sourceId = c.req.query('source_id');
    const lang = c.req.query('lang');
    const hasSummary = c.req.query('has_summary');
    const offset = (page - 1) * limit;

    let query = `
        SELECT n.*, s.name as source_name, s.language as source_lang,
               (SELECT COUNT(*) FROM news_comments nc WHERE nc.news_id = n.id AND nc.is_deleted = 0) as comments_count,
               ns.summary as ai_summary, nt.take as ai_take
        FROM news_items n 
        LEFT JOIN news_sources s ON n.source_id = s.id
        LEFT JOIN news_summaries ns ON ns.news_id = n.id
        LEFT JOIN news_ai_take nt ON nt.news_id = n.id
        WHERE n.is_deleted = 0
    `;
    let countQuery = 'SELECT COUNT(*) as total FROM news_items n LEFT JOIN news_sources s ON n.source_id = s.id LEFT JOIN news_summaries ns ON ns.news_id = n.id LEFT JOIN news_ai_take nt ON nt.news_id = n.id WHERE n.is_deleted = 0';
    const params: any[] = [];
    const conditions: string[] = [];

    if (hasSummary === '1') {
        conditions.push('ns.id IS NOT NULL');
    } else if (hasSummary === '0') {
        conditions.push('ns.id IS NULL');
    }

    if (category && category !== 'all') {
        conditions.push('n.category = ?');
        params.push(category);
    }

    if (sourceId) {
        conditions.push('n.source_id = ?');
        params.push(parseInt(sourceId));
    }

    if (lang) {
        conditions.push('s.language = ?');
        params.push(lang);
    }

    if (search) {
        // Try D1 FTS5 search with KV hot cache
        const indexedIds = await searchNewsFTS(c.env, search);
        if (indexedIds && indexedIds.length > 0) {
            const placeholders = indexedIds.map(() => '?').join(',');
            conditions.push(`n.id IN (${placeholders})`);
            params.push(...indexedIds);
        } else {
            // Fallback: LIKE search
            conditions.push('(n.title LIKE ? OR n.description LIKE ?)');
            params.push(`%${search}%`, `%${search}%`);
        }
    }

    if (conditions.length > 0) {
        const whereClause = ' AND ' + conditions.join(' AND ');
        query += whereClause;
        countQuery += whereClause;
    }

    query += ' ORDER BY n.created_at DESC, n.published_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    try {
        const [newsResult, countResult] = await Promise.all([
            c.env.DB.prepare(query).bind(...params).all(),
            c.env.DB.prepare(countQuery).bind(...params.slice(0, -2)).first()
        ]);

        const total = (countResult as any)?.total || 0;
        const totalPages = Math.ceil(total / limit);

        const result = {
            news: newsResult.results,
            pagination: { page, limit, total, totalPages, hasMore: page < totalPages },
        };

        return c.json(result);
    } catch (error) {
        console.error('Error fetching news:', error);
        return c.json({ error: '获取新闻失败' }, 500);
    }
});

// Get single news item
news.get('/:id', async (c) => {
    const id = c.req.param('id');

    try {
        const item = await c.env.DB.prepare(`
            SELECT n.*, s.name as source_name, s.language as source_lang,
                   ns.summary as ai_summary,
                   nt.take as ai_take
            FROM news_items n 
            LEFT JOIN news_sources s ON n.source_id = s.id 
            LEFT JOIN news_summaries ns ON ns.news_id = n.id
            LEFT JOIN news_ai_take nt ON nt.news_id = n.id
            WHERE n.id = ?
        `).bind(id).first();

        if (!item) {
            return c.json({ error: '新闻不存在' }, 404);
        }

        return c.json({ news: item });
    } catch (error) {
        console.error('Error fetching news item:', error);
        return c.json({ error: '获取新闻详情失败' }, 500);
    }
});

// Get multi-perspective comparison
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

// Get news sources
news.get('/sources/list', async (c) => {
    try {
        const sources = await c.env.DB.prepare(
            'SELECT * FROM news_sources ORDER BY sort_order, language, name'
        ).all();

        return c.json({ sources: sources.results });
    } catch (error) {
        console.error('Error fetching sources:', error);
        return c.json({ error: '获取新闻源失败' }, 500);
    }
});

// Get categories with counts
news.get('/categories/list', async (c) => {
    try {
        const categories = await c.env.DB.prepare(`
            SELECT category, COUNT(*) as count 
            FROM news_items 
            GROUP BY category 
            ORDER BY count DESC
        `).all();

        return c.json({ categories: categories.results });
    } catch (error) {
        console.error('Error fetching categories:', error);
        return c.json({ error: '获取分类失败' }, 500);
    }
});

export default news;

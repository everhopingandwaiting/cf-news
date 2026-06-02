import { Hono } from 'hono';
import { Bindings, NewsItem } from '../types';
import { generatePerspectives } from '../services/summarizer';

const news = new Hono<{ Bindings: Bindings }>();

async function searchNewsFTS(env: Bindings, query: string): Promise<number[] | null> {
    const normalized = query.toLowerCase().trim();
    if (!normalized) return null;

    // Sanitize FTS5 query — strip special chars, keep alphanumeric, CJK, spaces, hyphens
    const sanitized = normalized.replace(/[^\w\u4e00-\u9fff\s-]/g, ' ').trim();
    if (!sanitized) return null;

    // FTS5 unicode61 tokenizer treats each CJK char as a separate token,
    // making multi-char CJK queries unreliable. Use LIKE for CJK-heavy text.
    const hasCJK = /[\u4e00-\u9fff]/.test(sanitized);
    if (hasCJK) return null;

    let ids: number[] = [];
    try {
        const ftsQuery = sanitized.split(/\s+/).map(w => w + '*').join(' ');
        const result = await env.DB.prepare(
            'SELECT rowid FROM news_fts WHERE news_fts MATCH ? LIMIT 200'
        ).bind(ftsQuery).all<{ rowid: number }>();
        ids = result.results.map(r => r.rowid);
    } catch (e) {
        console.error('FTS5 search error:', e);
        return null;
    }

    return ids.length > 0 ? ids : null;
}

news.get('/', async (c) => {
    const cacheKey = new Request(c.req.url, { headers: { 'Accept': 'application/json' } });
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
            // Fallback: LIKE search on title only (description is too noisy)
            conditions.push('n.title LIKE ?');
            params.push(`%${search}%`);
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

        const response = c.json(result);
        if (!search) {
            response.headers.set('Cache-Control', 'public, s-maxage=60');
            c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
        }
        return response;
    } catch (error) {
        console.error('Error fetching news:', error);
        return c.json({ error: '获取新闻失败' }, 500);
    }
});

// GET /trending/topics — Time series of trending topics (from AI-populated table)
news.get('/trending/topics', async (c) => {
    const days = parseInt(c.req.query('days') || '2');
    try {
        const rows = await c.env.DB.prepare(`
            SELECT keyword, date_hour, count FROM trending_topics
            WHERE date_hour > datetime('now', '-' || ? || ' days')
            ORDER BY date_hour DESC, count DESC LIMIT 500
        `).bind(days).all<{ keyword: string; date_hour: string; count: number }>();

        if (rows.results.length === 0) return c.json({ topics: [] });

        const series: Record<string, { date_hour: string; count: number }[]> = {};
        for (const row of rows.results) {
            if (!series[row.keyword]) series[row.keyword] = [];
            series[row.keyword].push({ date_hour: row.date_hour, count: row.count });
        }
        const sorted = Object.entries(series)
            .map(([keyword, points]) => ({ keyword, total: points.reduce((s, p) => s + p.count, 0), points }))
            .sort((a, b) => b.total - a.total).slice(0, 20);
        return c.json({ topics: sorted });
    } catch (error) {
        console.error('trending/topics error:', error);
        return c.json({ topics: [] });
    }
});

// Asia/Shanghai time helpers (UTC+8). trending_topics.date_hour is stored in
// Shanghai time so the 24h window matches the user's local day.
function shanghaiToMs(dateHour: string): number {
    return new Date(dateHour.replace(' ', 'T') + '+08:00').getTime();
}

function shanghaiCutoff(hoursAgo: number, now: Date = new Date()): string {
    const shanghaiMs = now.getTime() + 8 * 3600 * 1000 - hoursAgo * 3600 * 1000;
    const hourMs = Math.floor(shanghaiMs / 3600000) * 3600000;
    return new Date(hourMs).toISOString().substring(0, 19).replace('T', ' ');
}

// GET /trending — Aggregate trending_topics with exponential time decay.
// 4h half-life so recent hours dominate over yesterday's leftovers.
news.get('/trending', async (c) => {
    try {
        const cutoff = shanghaiCutoff(24);
        const rows = await c.env.DB.prepare(`
            SELECT keyword, date_hour, count FROM trending_topics
            WHERE date_hour >= ?
            ORDER BY date_hour DESC LIMIT 500
        `).bind(cutoff).all<{ keyword: string; date_hour: string; count: number }>();

        if (rows.results.length === 0) return c.json({ trending: [] });

        const HALF_LIFE_HOURS = 4;
        const now = Date.now();
        const weighted = new Map<string, number>();
        for (const row of rows.results) {
            const ageHours = (now - shanghaiToMs(row.date_hour)) / 3600000;
            const w = Math.exp(-ageHours * Math.LN2 / HALF_LIFE_HOURS);
            weighted.set(row.keyword, (weighted.get(row.keyword) || 0) + row.count * w);
        }

        const trending = Array.from(weighted.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 30)
            .map(([word, score]) => ({ word, count: Math.round(score) }));

        return c.json({ trending });
    } catch (error) {
        console.error('trending error:', error);
        return c.json({ trending: [] });
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

// GET /:id/content — Fetch full article content
news.get('/:id/content', async (c) => {
    const id = parseInt(c.req.param('id'));
    try {
        const item = await c.env.DB.prepare(
            'SELECT id, title, url, content, description FROM news_items WHERE id = ? AND is_deleted = 0'
        ).bind(id).first<{ id: number; title: string; url: string; content: string | null; description: string | null }>();
        if (!item) return c.json({ error: '新闻不存在' }, 404);

        if (item.content && item.content.length > 500) {
            return c.json({ content: item.content });
        }

        const { fetchRichArticleContent } = await import('../services/contentFetcher');
        const rich = await fetchRichArticleContent(item.url);
        if (rich) {
            await c.env.DB.prepare(
                'UPDATE news_items SET content = ? WHERE id = ?'
            ).bind(rich.html, item.id).run();
            return c.json({ content: rich.html || rich.text });
        }

        return c.json({ content: item.description || item.content || '' });
    } catch (error) {
        console.error('Error fetching article content:', error);
        return c.json({ error: '获取文章内容失败' }, 500);
    }
});

export default news;

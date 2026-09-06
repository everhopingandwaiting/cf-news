import { Hono } from 'hono';
import { Bindings, NewsItem } from '../types';
import { generatePerspectives } from '../services/summarizer';
import { eq, sql, and, count, desc, like, SQL } from 'drizzle-orm';
import { getDb } from '../db';
import { newsItems, newsSources, newsSummaries, newsAiTake, newsComments, newsFts } from '../db/schema';
import { verifyJWT } from './auth';

const news = new Hono<{ Bindings: Bindings }>();

const REGION_HINTS: { code: string; name: string; terms: string[] }[] = [
    { code: 'CN', name: '中国', terms: ['中国', '北京', '上海', '深圳', '香港', '台湾', 'China', 'Beijing', 'Shanghai', 'Hong Kong', 'Taiwan'] },
    { code: 'US', name: '美国', terms: ['美国', '华盛顿', '纽约', '硅谷', 'United States', 'US ', 'U.S.', 'America', 'Washington', 'New York', 'Silicon Valley'] },
    { code: 'JP', name: '日本', terms: ['日本', '东京', 'Japan', 'Tokyo'] },
    { code: 'KR', name: '韩国', terms: ['韩国', '首尔', 'Korea', 'Seoul'] },
    { code: 'GB', name: '英国', terms: ['英国', '伦敦', 'UK', 'Britain', 'London'] },
    { code: 'EU', name: '欧洲', terms: ['欧洲', '欧盟', 'EU', 'Europe', 'Brussels'] },
    { code: 'RU', name: '俄罗斯', terms: ['俄罗斯', '莫斯科', 'Russia', 'Moscow'] },
    { code: 'IN', name: '印度', terms: ['印度', 'India', 'Delhi', 'Mumbai'] },
    { code: 'IL', name: '以色列', terms: ['以色列', 'Israel'] },
    { code: 'UA', name: '乌克兰', terms: ['乌克兰', 'Ukraine', 'Kyiv'] },
    { code: 'SG', name: '新加坡', terms: ['新加坡', 'Singapore'] },
];

function parseHours(value: string | undefined, fallback = 24, max = 168): number {
    const hours = parseInt(value || String(fallback), 10);
    return Number.isFinite(hours) && hours > 0 ? Math.min(hours, max) : fallback;
}

function escapeLike(value: string): string {
    return value.replace(/[%_\\]/g, '\\$&');
}

function normalizeKeyword(value: string): string {
    return value.trim().replace(/\s+/g, ' ').slice(0, 80);
}

function detectRegions(title = '', description = '') {
    const haystack = `${title} ${description}`;
    return REGION_HINTS.filter(region => region.terms.some(term => haystack.includes(term)));
}

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
        // FTS5 MATCH cannot take a bound parameter on D1 — inline the sanitized
        // query (query is restricted to word chars above, so no injection).
        const result = await db.all<{ rowid: number }>(
            sql`SELECT rowid FROM news_fts WHERE news_fts MATCH ${sql.raw(`'${ftsQuery}'`)} LIMIT 200`
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
    // 搜索热词遥测：非阻塞写入 Analytics Engine（不 await，避免影响响应延迟）
    if (search && c.env.ANALYTICS) {
        c.env.ANALYTICS.writeDataPoint({
            indexes: [],
            blobs: ['search', search.toLowerCase().slice(0, 100)],
            doubles: [],
        });
    }
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
            conds.push(sql`n.id IN (${sql.raw(indexedIds.join(','))})`);
        } else {
            const escaped = search.replace(/[%_\\]/g, '\\$&');
            conds.push(sql`n.title LIKE ${'%' + escaped + '%'} ESCAPE '\\'`);
        }
    }

    const whereClause = sql.join(conds, sql` AND `);

    try {
        // 只在 WHERE 真正用到时才 JOIN：默认列表页零关联；nt 在条件中从未被引用，直接去掉
        const countJoins: SQL[] = [];
        if (lang) countJoins.push(sql`LEFT JOIN news_sources s ON n.source_id = s.id`);
        if (hasSummary === '1' || hasSummary === '0') countJoins.push(sql`LEFT JOIN news_summaries ns ON ns.news_id = n.id`);
        const countResult = await db.all<{ total: number }>(sql`
            SELECT COUNT(*) as total
            FROM news_items n
            ${countJoins.length > 0 ? sql.join(countJoins, sql` `) : sql``}
            WHERE ${whereClause}
        `);
        const total = countResult[0]?.total || 0;
        const totalPages = Math.ceil(total / limit);

        const newsData = await db.all<any>(sql`
            SELECT n.*, s.name as source_name, s.language as source_lang,
                   (SELECT COUNT(*) FROM news_comments nc WHERE nc.news_id = n.id AND nc.is_deleted = 0) as comments_count,
                   ns.summary as ai_summary, ns.illustration_url as ai_illustration, nt.take as ai_take
            FROM news_items n
            LEFT JOIN news_sources s ON n.source_id = s.id
            LEFT JOIN news_summaries ns ON ns.news_id = n.id
            LEFT JOIN news_ai_take nt ON nt.news_id = n.id
            WHERE ${whereClause}
            ORDER BY n.created_at DESC
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

// GET /timeline — Event timeline for a search term or recent important news
news.get('/timeline', async (c) => {
    const keyword = normalizeKeyword(c.req.query('keyword') || '');
    const hours = parseHours(c.req.query('hours'), keyword ? 168 : 48);
    const db = getDb(c.env);
    try {
        const timelineTime = sql`COALESCE(n.published_at, n.created_at)`;
        const conds: SQL[] = [sql`n.is_deleted = 0`, sql`${timelineTime} >= datetime('now', '-' || ${hours} || ' hours')`];
        if (keyword) {
            const escaped = escapeLike(keyword);
            conds.push(sql`(n.title LIKE ${'%' + escaped + '%'} ESCAPE '\\' OR n.description LIKE ${'%' + escaped + '%'} ESCAPE '\\')`);
        }
        const whereClause = sql.join(conds, sql` AND `);
        const rows = await db.all<any>(sql`
            SELECT n.id, n.title, n.url, n.description, n.category, n.image_url,
                   n.published_at, n.created_at, s.name as source_name, s.language as source_lang,
                   ns.summary as ai_summary
            FROM news_items n
            LEFT JOIN news_sources s ON n.source_id = s.id
            LEFT JOIN news_summaries ns ON ns.news_id = n.id
            WHERE ${whereClause}
            ORDER BY ${timelineTime} DESC
            LIMIT 40
        `);
        const events = rows.map((row: any, index: number) => ({
            ...row,
            time: row.published_at || row.created_at,
            stage: index === 0 ? 'latest' : index === rows.length - 1 ? 'first' : 'update',
        }));
        return c.json({ keyword: keyword || null, events });
    } catch (error) {
        console.error('timeline error:', error);
        return c.json({ error: '获取新闻时间线失败' }, 500);
    }
});

// GET /map — Region distribution inferred from titles/descriptions
news.get('/map', async (c) => {
    const hours = parseHours(c.req.query('hours'), 24);
    const db = getDb(c.env);
    try {
        const rows = await db.all<any>(sql`
            SELECT n.id, n.title, n.description, n.category, n.published_at, n.created_at,
                   s.name as source_name, s.language as source_lang
            FROM news_items n
            LEFT JOIN news_sources s ON n.source_id = s.id
            WHERE n.is_deleted = 0 AND n.created_at >= datetime('now', '-' || ${hours} || ' hours')
            ORDER BY COALESCE(n.published_at, n.created_at) DESC
            LIMIT 300
        `);
        const byRegion = new Map<string, { code: string; name: string; count: number; articles: any[] }>();
        for (const row of rows) {
            for (const region of detectRegions(row.title, row.description || '')) {
                const current = byRegion.get(region.code) || { code: region.code, name: region.name, count: 0, articles: [] };
                current.count += 1;
                if (current.articles.length < 5) current.articles.push(row);
                byRegion.set(region.code, current);
            }
        }
        return c.json({ regions: Array.from(byRegion.values()).sort((a, b) => b.count - a.count) });
    } catch (error) {
        console.error('map error:', error);
        return c.json({ error: '获取新闻地图失败' }, 500);
    }
});

// GET /fresh-view — 反信息茧房推荐：排除用户主导分类，并按"新颖度"排序
// novelty_score = 来源新颖度 + 时效性 + 分类新颖度（登录用户基于阅读历史计算）
news.get('/fresh-view', async (c) => {
    const exclude = (c.req.query('exclude') || '').split(',').map(v => v.trim()).filter(Boolean).slice(0, 8);
    const limit = Math.min(parseInt(c.req.query('limit') || '8', 10) || 8, 12);
    const db = getDb(c.env);
    try {
        // 可选 JWT：有有效 token 则读取阅读历史计算个性化新颖度；无 token 时仅按时效性排序
        let userId: number | null = null;
        const authHeader = c.req.header('Authorization') || '';
        if (authHeader.startsWith('Bearer ')) {
            const payload = await verifyJWT(authHeader.slice(7).trim(), c.env.JWT_SECRET);
            if (payload) userId = payload.sub;
        }

        // 从阅读历史统计：每个来源被阅读的次数、每个分类被阅读的次数
        const sourceReadCount = new Map<number, number>();
        const categoryReadCount = new Map<string, number>();
        if (userId) {
            const history = await db.all<{ source_id: number; category: string; cnt: number }>(sql`
                SELECT n.source_id, n.category, COUNT(*) as cnt
                FROM user_read_history h
                JOIN news_items n ON n.id = h.news_id
                WHERE h.user_id = ${userId}
                GROUP BY n.source_id, n.category
            `);
            for (const row of history) {
                sourceReadCount.set(row.source_id, (sourceReadCount.get(row.source_id) || 0) + row.cnt);
                categoryReadCount.set(row.category, (categoryReadCount.get(row.category) || 0) + row.cnt);
            }
        }

        const conds: SQL[] = [sql`n.is_deleted = 0`, sql`n.created_at >= datetime('now', '-72 hours')`];
        if (exclude.length > 0) conds.push(sql`n.category NOT IN (${sql.join(exclude.map(cat => sql`${cat}`), sql`, `)})`);
        // 候选池：优先有摘要、按时间倒序，取最多 30 条后在 JS 中按新颖度重排
        const rows = await db.all<any>(sql`
            SELECT n.id, n.source_id, n.title, n.url, n.description, n.image_url, n.category,
                   n.published_at, n.created_at, s.name as source_name, s.language as source_lang,
                   ns.summary as ai_summary, ns.illustration_url as ai_illustration, nt.take as ai_take
            FROM news_items n
            LEFT JOIN news_sources s ON n.source_id = s.id
            LEFT JOIN news_summaries ns ON ns.news_id = n.id
            LEFT JOIN news_ai_take nt ON nt.news_id = n.id
            WHERE ${sql.join(conds, sql` AND `)}
            ORDER BY CASE WHEN ns.id IS NOT NULL THEN 0 ELSE 1 END, COALESCE(n.published_at, n.created_at) DESC
            LIMIT 30
        `);

        const recommendations = rows.map((row: any) => {
            // 1) 来源新颖度：从未读过的来源 +2；只读过 1-2 次 +1；频繁阅读 +0
            let sourceNovelty = 0;
            if (userId) {
                const cnt = sourceReadCount.get(row.source_id) || 0;
                sourceNovelty = cnt === 0 ? 2 : cnt <= 2 ? 1 : 0;
            }
            // 2) 时效性：24 小时内 +1；48 小时内 +0.5；更早 +0
            const timeStr = (row.published_at || row.created_at || '').replace(' ', 'T');
            const timeMs = timeStr ? new Date(timeStr.endsWith('Z') ? timeStr : timeStr + 'Z').getTime() : NaN;
            const hoursAgo = Number.isFinite(timeMs) ? (Date.now() - timeMs) / 3600000 : NaN;
            let recencyFactor = 0;
            if (hoursAgo <= 24) recencyFactor = 1;
            else if (hoursAgo <= 48) recencyFactor = 0.5;
            // 3) 分类新颖度：阅读历史中越少出现的分类，加分越多
            let categoryNovelty = 0;
            if (userId) {
                const cnt = categoryReadCount.get(row.category) || 0;
                categoryNovelty = cnt === 0 ? 1 : cnt <= 2 ? 0.5 : 0;
            }
            return { ...row, novelty_score: Number((sourceNovelty + recencyFactor + categoryNovelty).toFixed(2)) };
        });

        // 按新颖度降序排列，截取请求的条数
        recommendations.sort((a: any, b: any) => b.novelty_score - a.novelty_score);
        return c.json({ recommendations: recommendations.slice(0, limit) });
    } catch (error) {
        console.error('fresh-view error:', error);
        return c.json({ error: '获取反信息茧房推荐失败' }, 500);
    }
});

news.get('/:id', async (c) => {
    const id = c.req.param('id');
    const db = getDb(c.env);
    try {
        const item = await db.all<any>(sql`
            SELECT n.*, s.name as source_name, s.language as source_lang,
                   ns.summary as ai_summary, ns.illustration_url as ai_illustration, nt.take as ai_take
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

// GET /:id/credibility — Source diversity and corroboration hints for an article
news.get('/:id/credibility', async (c) => {
    const id = parseInt(c.req.param('id'), 10);
    if (!Number.isFinite(id)) return c.json({ error: 'Invalid id' }, 400);
    const db = getDb(c.env);
    try {
        const item = await db.all<any>(sql`
            SELECT n.id, n.title, n.description, n.category, n.created_at, s.name as source_name
            FROM news_items n
            LEFT JOIN news_sources s ON n.source_id = s.id
            WHERE n.id = ${id} AND n.is_deleted = 0
            LIMIT 1
        `);
        if (item.length === 0) return c.json({ error: '新闻不存在' }, 404);

        const words = item[0].title
            .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
            .split(/\s+/)
            .filter((word: string) => word.length >= 2)
            .slice(0, 5);
        const conditions = words.length > 0
            ? sql.join(words.map((word: string) => {
                const escaped = escapeLike(word);
                return sql`(n.title LIKE ${'%' + escaped + '%'} ESCAPE '\\' OR n.description LIKE ${'%' + escaped + '%'} ESCAPE '\\')`;
            }), sql` OR `)
            : sql`n.category = ${item[0].category}`;

        const matches = await db.all<any>(sql`
            SELECT n.id, n.title, n.url, n.category, n.published_at, n.created_at,
                   s.name as source_name, s.language as source_lang
            FROM news_items n
            LEFT JOIN news_sources s ON n.source_id = s.id
            WHERE n.is_deleted = 0
              AND n.id != ${id}
              AND n.created_at >= datetime(${item[0].created_at}, '-72 hours')
              AND n.created_at <= datetime(${item[0].created_at}, '+72 hours')
              AND (${conditions})
            ORDER BY COALESCE(n.published_at, n.created_at) DESC
            LIMIT 20
        `);
        const sourceNames = new Set(matches.map((row: any) => row.source_name).filter(Boolean));
        const languages = new Set(matches.map((row: any) => row.source_lang).filter(Boolean));
        const score = Math.min(100, 25 + sourceNames.size * 18 + languages.size * 10 + Math.min(matches.length, 8) * 3);
        return c.json({
            score,
            level: score >= 75 ? 'strong' : score >= 50 ? 'medium' : 'weak',
            source_count: sourceNames.size + (item[0].source_name ? 1 : 0),
            related_count: matches.length,
            languages: Array.from(languages),
            signals: [
                sourceNames.size >= 2 ? '多来源报道' : '来源较少',
                languages.size >= 2 ? '跨语言来源' : '单一语言来源',
                matches.length >= 5 ? '同类报道较多' : '同类报道有限',
            ],
            articles: matches.slice(0, 6),
        });
    } catch (error) {
        console.error('credibility error:', error);
        return c.json({ error: '获取可信度分析失败' }, 500);
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
    const cacheVer = await c.env.KV.get('news_cache_ver').catch(() => null) || '0';
    const cacheKey = new Request(c.req.url + '&_cv=' + cacheVer, { headers: { 'Accept': 'application/json' } });
    const cache = caches.default;
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const db = getDb(c.env);
    try {
        const categories = await db.all<{ category: string; count: number }>(sql`
            SELECT category, COUNT(*) as count
            FROM news_items
            WHERE is_deleted = 0
            GROUP BY category
            ORDER BY count DESC
        `);
        const response = c.json({ categories });
        response.headers.set('Cache-Control', 'public, max-age=600, s-maxage=600');
        c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
        return response;
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

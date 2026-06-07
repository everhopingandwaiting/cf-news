import { Hono } from 'hono';
import { Bindings } from '../types';
import { shanghaiCutoff } from '../services/trending';

const trending = new Hono<{ Bindings: Bindings }>();

// GET /trending/topics — Time series of trending topics (from AI-populated table)
trending.get('/trending/topics', async (c) => {
    const hours = parseInt(c.req.query('hours') || '', 10);
    const days = parseInt(c.req.query('days') || '2', 10);
    const period = !isNaN(hours) ? hours : days * 24;
    const cutoff = shanghaiCutoff(period);
    try {
        const rows = await c.env.DB.prepare(`
            SELECT keyword, date_hour, count FROM trending_topics
            WHERE date_hour >= ?
            ORDER BY date_hour DESC, count DESC LIMIT 500
        `).bind(cutoff).all<{ keyword: string; date_hour: string; count: number }>();

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

// GET /trending — Aggregate trending_topics with exponential time decay
trending.get('/trending', async (c) => {
    const hours = parseInt(c.req.query('hours') || '24', 10);
    try {
        const cutoff = shanghaiCutoff(hours);
        const rows = await c.env.DB.prepare(`
            SELECT keyword, date_hour, count FROM trending_topics
            WHERE date_hour >= ?
            ORDER BY date_hour DESC LIMIT 1000
        `).bind(cutoff).all<{ keyword: string; date_hour: string; count: number }>();

        if (rows.results.length === 0) return c.json({ trending: [] });

        const HALF_LIFE_HOURS = 4;
        const now = new Date();
        const shanghaiNow = new Date(now.getTime() + 8 * 3600 * 1000);

        const byKeyword = new Map<string, { date_hour: string; count: number }[]>();
        const weighted = new Map<string, number>();
        for (const row of rows.results) {
            const rowDate = new Date(row.date_hour.replace(' ', 'T') + '+08:00');
            const ageHours = (shanghaiNow.getTime() - rowDate.getTime()) / 3600000;
            const w = Math.exp(-ageHours * Math.LN2 / HALF_LIFE_HOURS);
            weighted.set(row.keyword, (weighted.get(row.keyword) || 0) + row.count * w);
            if (!byKeyword.has(row.keyword)) byKeyword.set(row.keyword, []);
            byKeyword.get(row.keyword)!.push({ date_hour: row.date_hour, count: row.count });
        }

        const sorted = Array.from(weighted.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 30);

        const topKeywords = sorted.slice(0, 15).map(([w]) => w);
        const sourceResults = new Map<string, { name: string; count: number }[]>();
        if (topKeywords.length > 0) {
            const stmts = topKeywords.map(kw => {
                const escaped = kw.replace(/[%_]/g, '=$&');
                return c.env.DB.prepare(`
                    SELECT ns.name, COUNT(*) as count
                    FROM news_items ni
                    JOIN news_sources ns ON ni.source_id = ns.id
                    WHERE ni.created_at >= datetime('now', '-' || ? || ' hours')
                      AND (ni.title LIKE ? ESCAPE '=' OR ni.description LIKE ? ESCAPE '=')
                    GROUP BY ns.name
                    ORDER BY count DESC
                    LIMIT 3
                `).bind(hours, `%${escaped}%`, `%${escaped}%`);
            });
            try {
                const batchResults = await c.env.DB.batch(stmts);
                topKeywords.forEach((kw, i) => {
                    const sources = (batchResults[i]?.results || []) as { name: string; count: number }[];
                    sourceResults.set(kw, sources);
                });
            } catch (e) {
                console.error('source breakdown error:', e);
            }
        }

        const trending = sorted.map(([word, score]) => {
            const entries = (byKeyword.get(word) || []).sort((a, b) => a.date_hour.localeCompare(b.date_hour));
            let burst = false;
            let burst_score = 0;
            if (entries.length >= 3) {
                const last2 = entries.slice(-2).reduce((s, e) => s + e.count, 0);
                const earlier = entries.slice(0, -2).reduce((s, e) => s + e.count, 0);
                const avgEarlier = earlier / (entries.length - 2);
                if (avgEarlier > 0) {
                    burst_score = Math.round(((last2 / 2) / avgEarlier) * 10) / 10;
                    burst = burst_score > 2;
                }
            }
            let change_pct = 0;
            const midIdx = Math.floor(entries.length / 2);
            if (midIdx > 0) {
                const firstHalf = entries.slice(0, midIdx).reduce((s, e) => s + e.count, 0);
                const secondHalf = entries.slice(midIdx).reduce((s, e) => s + e.count, 0);
                change_pct = firstHalf > 0 ? Math.round(((secondHalf - firstHalf) / firstHalf) * 100) : 0;
            }
            const is_new = entries.length > 0 && entries.every(e => {
                const entryTime = new Date(e.date_hour.replace(' ', 'T') + '+08:00').getTime();
                const midTime = shanghaiNow.getTime() - (hours * 3600000) / 2;
                return entryTime >= midTime;
            });
            return {
                word,
                count: Math.round(score),
                sources: sourceResults.get(word) || [],
                burst,
                burst_score,
                change_pct,
                is_new,
            };
        });

        const prevCutoff = shanghaiCutoff(hours * 2);
        const currentSet = new Set(sorted.map(([w]) => w));
        let dropped: string[] = [];
        try {
            const prevRows = await c.env.DB.prepare(`
                SELECT keyword, SUM(count) as total FROM trending_topics
                WHERE date_hour >= ? AND date_hour < ?
                GROUP BY keyword ORDER BY total DESC LIMIT 15
            `).bind(prevCutoff, cutoff).all<{ keyword: string; total: number }>();
            dropped = prevRows.results
                .map(r => r.keyword)
                .filter(k => !currentSet.has(k));
        } catch (e) {
            console.error('dropped keywords query error:', e);
        }
        return c.json({ trending, dropped });
    } catch (error) {
        console.error('trending error:', error);
        return c.json({ trending: [] });
    }
});

// GET /trending/categories — Category distribution of trending keywords
trending.get('/trending/categories', async (c) => {
    const hours = parseInt(c.req.query('hours') || '24', 10);
    try {
        const cutoff = shanghaiCutoff(hours);
        const kwRows = await c.env.DB.prepare(`
            SELECT DISTINCT keyword FROM trending_topics WHERE date_hour >= ?
        `).bind(cutoff).all<{ keyword: string }>();
        if (kwRows.results.length === 0) return c.json({ categories: [], total: 0 });

        const conditions = kwRows.results.map(() =>
            `(ni.title LIKE ? ESCAPE '=' OR ni.description LIKE ? ESCAPE '=')`
        ).join(' OR ');
        const params: string[] = [];
        for (const { keyword } of kwRows.results) {
            const escaped = keyword.replace(/[%_]/g, '=$&');
            params.push(`%${escaped}%`, `%${escaped}%`);
        }
        const catRows = await c.env.DB.prepare(`
            SELECT ni.category, COUNT(*) as count
            FROM news_items ni
            WHERE ni.created_at >= datetime('now', '-' || ? || ' hours')
              AND ni.is_deleted = 0
              AND (${conditions})
            GROUP BY ni.category
            ORDER BY count DESC
        `).bind(hours, ...params).all<{ category: string; count: number }>();
        const total = catRows.results.reduce((s, r) => s + r.count, 0);
        const categories = catRows.results.map(r => ({
            name: r.category, count: r.count,
            pct: total > 0 ? Math.round((r.count / total) * 100) : 0,
        }));
        return c.json({ categories, total });
    } catch (error) {
        console.error('trending/categories error:', error);
        return c.json({ categories: [], total: 0 });
    }
});

// GET /trending/compare — Multi-keyword time series comparison
trending.get('/trending/compare', async (c) => {
    const keywords = (c.req.query('keywords') || '').split(',').filter(Boolean);
    const hours = parseInt(c.req.query('hours') || '48', 10);
    if (keywords.length === 0) return c.json({ series: [] });
    if (keywords.length > 10) return c.json({ error: '最多比较10个关键词' }, 400);
    try {
        const cutoff = shanghaiCutoff(hours);
        const placeholders = keywords.map(() => '?').join(',');
        const rows = await c.env.DB.prepare(`
            SELECT keyword, date_hour, count FROM trending_topics
            WHERE date_hour >= ? AND keyword IN (${placeholders})
            ORDER BY date_hour ASC
        `).bind(cutoff, ...keywords).all<{ keyword: string; date_hour: string; count: number }>();
        const series: Record<string, { date_hour: string; count: number }[]> = {};
        for (const row of rows.results) {
            if (!series[row.keyword]) series[row.keyword] = [];
            series[row.keyword].push({ date_hour: row.date_hour, count: row.count });
        }
        return c.json({
            series: keywords.map(kw => ({ keyword: kw, points: series[kw] || [] })),
        });
    } catch (error) {
        console.error('trending/compare error:', error);
        return c.json({ series: [] });
    }
});

// GET /trending/hourly — 每小时来源和分类分布
trending.get('/trending/hourly', async (c) => {
    const hours = parseInt(c.req.query('hours') || '24');
    try {
        const cutoff = `datetime('now', '-${hours} hours')`;
        const [sourceRows, catRows] = await Promise.all([
            c.env.DB.prepare(`
                SELECT substr(ni.created_at,1,13) as hour, ni.source_id, s.name as source_name, COUNT(*) as count
                FROM news_items ni
                LEFT JOIN news_sources s ON ni.source_id = s.id
                WHERE ni.is_deleted = 0 AND ni.created_at > ${cutoff}
                GROUP BY hour, ni.source_id
                ORDER BY hour, count DESC
            `).all<{ hour: string; source_id: number; source_name: string; count: number }>(),
            c.env.DB.prepare(`
                SELECT substr(created_at,1,13) as hour, category, COUNT(*) as count
                FROM news_items
                WHERE is_deleted = 0 AND created_at > ${cutoff}
                GROUP BY hour, category
                ORDER BY hour, category
            `).all<{ hour: string; category: string; count: number }>(),
        ]);
        return c.json({ sources: sourceRows.results, categories: catRows.results });
    } catch (e: any) {
        console.error('Hourly stats error:', e);
        return c.json({ error: String(e) }, 500);
    }
});

export default trending;

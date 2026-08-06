import { Hono } from 'hono';
import { Bindings } from '../types';
import { shanghaiCutoff } from '../services/trending';
import { fetchInternetServiceRanking } from '../services/radar';
import { callAI } from '../services/aiProvider';
import { generatePerspectives } from '../services/summarizer';
import { eq, sql, and, desc, like, inArray, gte, SQL } from 'drizzle-orm';
import { getDb } from '../db';
import { trendingTopics, newsItems, newsSources } from '../db/schema';

const trending = new Hono<{ Bindings: Bindings }>();

interface ThemeKeyword {
    keyword: string;
    total: number;
    latest: number;
    previous: number;
}

function escapeThemeLike(value: string): string {
    return value.replace(/_/g, ' ').replace(/[%_\\]/g, '\\$&');
}

function normalizeThemeKeyword(keyword: string): string {
    return keyword.replace(/_/g, ' ').trim().toLowerCase();
}

function parseThemeHours(value: string | undefined): number {
    const hours = parseInt(value || '24', 10);
    return Number.isFinite(hours) && hours >= 1 && hours <= 168 ? hours : 24;
}

function buildThemeClusters(keywords: ThemeKeyword[]) {
    const clusters: { label: string; keywords: ThemeKeyword[]; total: number; latest: number; previous: number }[] = [];
    for (const kw of keywords) {
        const normalized = normalizeThemeKeyword(kw.keyword);
        let cluster = clusters.find(c => {
            const label = normalizeThemeKeyword(c.label);
            return label.includes(normalized) || normalized.includes(label)
                || c.keywords.some(existing => {
                    const e = normalizeThemeKeyword(existing.keyword);
                    return e.includes(normalized) || normalized.includes(e);
                });
        });
        if (!cluster) {
            cluster = { label: kw.keyword, keywords: [], total: 0, latest: 0, previous: 0 };
            clusters.push(cluster);
        }
        cluster.keywords.push(kw);
        cluster.total += kw.total;
        cluster.latest += kw.latest;
        cluster.previous += kw.previous;
        cluster.label = cluster.keywords.slice().sort((a, b) => b.total - a.total)[0].keyword;
    }
    return clusters.sort((a, b) => b.total - a.total);
}

// GET /trending/topics — Time series of trending topics (from AI-populated table)
trending.get('/trending/topics', async (c) => {
    const hours = parseInt(c.req.query('hours') || '', 10);
    const days = parseInt(c.req.query('days') || '2', 10);
    const period = !isNaN(hours) ? hours : days * 24;
    const cutoff = shanghaiCutoff(period);
    const db = getDb(c.env);
    try {
        const rows = await db.select({
            keyword: trendingTopics.keyword,
            date_hour: trendingTopics.date_hour,
            count: trendingTopics.count,
        }).from(trendingTopics)
            .where(gte(trendingTopics.date_hour, cutoff))
            .orderBy(desc(trendingTopics.date_hour), desc(trendingTopics.count))
            .limit(500)
            .all();

        if (rows.length === 0) return c.json({ topics: [] });

        const series: Record<string, { date_hour: string; count: number }[]> = {};
        for (const row of rows) {
            if (!series[row.keyword]) series[row.keyword] = [];
            series[row.keyword].push({ date_hour: row.date_hour, count: row.count ?? 0 });
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
    const db = getDb(c.env);
    try {
        const cutoff = shanghaiCutoff(hours);
        const rows = await db.select({
            keyword: trendingTopics.keyword,
            date_hour: trendingTopics.date_hour,
            count: trendingTopics.count,
        }).from(trendingTopics)
            .where(gte(trendingTopics.date_hour, cutoff))
            .orderBy(desc(trendingTopics.date_hour))
            .limit(1000)
            .all();

        if (rows.length === 0) return c.json({ trending: [] });

        const HALF_LIFE_HOURS = 4;
        const now = new Date();
        const shanghaiNow = new Date(now.getTime() + 8 * 3600 * 1000);

        const byKeyword = new Map<string, { date_hour: string; count: number }[]>();
        const weighted = new Map<string, number>();
        for (const row of rows) {
            const rowDate = new Date(row.date_hour.replace(' ', 'T') + '+08:00');
            const ageHours = (shanghaiNow.getTime() - rowDate.getTime()) / 3600000;
            const w = Math.exp(-ageHours * Math.LN2 / HALF_LIFE_HOURS);
            weighted.set(row.keyword, (weighted.get(row.keyword) || 0) + (row.count ?? 0) * w);
            if (!byKeyword.has(row.keyword)) byKeyword.set(row.keyword, []);
            byKeyword.get(row.keyword)!.push({ date_hour: row.date_hour, count: row.count ?? 0 });
        }

        const sorted = Array.from(weighted.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 30);

        const topKeywords = sorted.slice(0, 15).map(([w]) => w);
        const sourceResults = new Map<string, { name: string; count: number }[]>();
        if (topKeywords.length > 0) {
            const stmts = topKeywords.map(kw => {
                const escaped = kw.replace(/[%_]/g, '=$&');
                return db.all<{ name: string; count: number }>(sql`
                    SELECT ns.name, COUNT(*) as count
                    FROM news_items ni
                    JOIN news_sources ns ON ni.source_id = ns.id
                    WHERE ni.created_at >= datetime('now', '-' || ${hours} || ' hours')
                      AND (ni.title LIKE ${'%' + escaped + '%'} ESCAPE '=' OR ni.description LIKE ${'%' + escaped + '%'} ESCAPE '=')
                    GROUP BY ns.name
                    ORDER BY count DESC
                    LIMIT 3
                `);
            });
            try {
                const batchResults = await Promise.all(stmts);
                topKeywords.forEach((kw, i) => {
                    const sources = (batchResults[i] || []) as { name: string; count: number }[];
                    sourceResults.set(kw, sources);
                });
            } catch (e) {
                console.error('source breakdown error:', e);
            }
        }

        const trendingData = sorted.map(([word, score]) => {
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
            const prevRows = await db.all<{ keyword: string; total: number }>(sql`
                SELECT keyword, SUM(count) as total FROM trending_topics
                WHERE date_hour >= ${prevCutoff} AND date_hour < ${cutoff}
                GROUP BY keyword ORDER BY total DESC LIMIT 15
            `);
            dropped = prevRows
                .map(r => r.keyword)
                .filter(k => !currentSet.has(k));
        } catch (e) {
            console.error('dropped keywords query error:', e);
        }
        return c.json({ trending: trendingData, dropped });
    } catch (error) {
        console.error('trending error:', error);
        return c.json({ trending: [] });
    }
});

// GET /trending/themes — Topic clusters with representative news
trending.get('/trending/themes', async (c) => {
    const hours = parseThemeHours(c.req.query('hours'));
    const db = getDb(c.env);
    try {
        const cutoff = shanghaiCutoff(hours);
        const rows = await db.select({
            keyword: trendingTopics.keyword,
            date_hour: trendingTopics.date_hour,
            count: trendingTopics.count,
        }).from(trendingTopics)
            .where(gte(trendingTopics.date_hour, cutoff))
            .orderBy(desc(trendingTopics.date_hour), desc(trendingTopics.count))
            .limit(1000)
            .all();

        if (rows.length === 0) return c.json({ themes: [] });

        const byKeyword = new Map<string, { date_hour: string; count: number }[]>();
        for (const row of rows) {
            if (!byKeyword.has(row.keyword)) byKeyword.set(row.keyword, []);
            byKeyword.get(row.keyword)!.push({ date_hour: row.date_hour, count: row.count ?? 0 });
        }

        const keywordStats: ThemeKeyword[] = Array.from(byKeyword.entries())
            .map(([keyword, points]) => {
                const sorted = points.sort((a, b) => a.date_hour.localeCompare(b.date_hour));
                const mid = Math.max(1, Math.floor(sorted.length / 2));
                const previous = sorted.slice(0, mid).reduce((s, p) => s + p.count, 0);
                const latest = sorted.slice(mid).reduce((s, p) => s + p.count, 0);
                return { keyword, total: previous + latest, latest, previous };
            })
            .sort((a, b) => b.total - a.total)
            .slice(0, 30);

        const clusters = buildThemeClusters(keywordStats).slice(0, 8);
        const themes = [];

        for (const cluster of clusters) {
            const topKeywords = cluster.keywords.slice(0, 4).map(k => k.keyword);
            const likeConditions = topKeywords.map(kw => {
                const escaped = escapeThemeLike(kw);
                return sql`(n.title LIKE ${'%' + escaped + '%'} ESCAPE '\\' OR n.description LIKE ${'%' + escaped + '%'} ESCAPE '\\')`;
            });
            const matchCondition = sql.join(likeConditions, sql` OR `);
            const articles = await db.all<any>(sql`
                SELECT n.id, n.source_id, n.title, n.url, n.description, n.image_url, n.category,
                       n.published_at, n.created_at, s.name as source_name, s.language as source_lang,
                       ns.summary as ai_summary, nt.take as ai_take
                FROM news_items n
                LEFT JOIN news_sources s ON n.source_id = s.id
                LEFT JOIN news_summaries ns ON ns.news_id = n.id
                LEFT JOIN news_ai_take nt ON nt.news_id = n.id
                WHERE n.is_deleted = 0
                  AND n.created_at >= datetime('now', '-' || ${hours} || ' hours')
                  AND (${matchCondition})
                ORDER BY COALESCE(n.published_at, n.created_at) DESC
                LIMIT 5
            `);
            const changePct = cluster.previous > 0
                ? Math.round(((cluster.latest - cluster.previous) / cluster.previous) * 100)
                : (cluster.latest > 0 ? 100 : 0);
            themes.push({
                label: cluster.label,
                total: cluster.total,
                latest: cluster.latest,
                previous: cluster.previous,
                change_pct: changePct,
                status: changePct >= 50 ? 'rising' : changePct <= -30 ? 'falling' : 'steady',
                keywords: topKeywords,
                articles,
            });
        }

        return c.json({ themes });
    } catch (error) {
        console.error('trending/themes error:', error);
        return c.json({ themes: [] });
    }
});

// GET /trending/categories — Category distribution of trending keywords
trending.get('/trending/categories', async (c) => {
    const hours = parseInt(c.req.query('hours') || '24', 10);
    const db = getDb(c.env);
    try {
        const cutoff = shanghaiCutoff(hours);
        const kwRows = await db.select({ keyword: trendingTopics.keyword })
            .from(trendingTopics)
            .where(gte(trendingTopics.date_hour, cutoff))
            .all();
        if (kwRows.length === 0) return c.json({ categories: [], total: 0 });

        // Build dynamic OR of LIKE conditions with ESCAPE
        const likeConditions: SQL[] = kwRows.map(({ keyword }) => {
            const escaped = keyword.replace(/[%_]/g, '=$&');
            return sql`(ni.title LIKE ${'%' + escaped + '%'} ESCAPE '=' OR ni.description LIKE ${'%' + escaped + '%'} ESCAPE '=')`;
        });
        const fullCondition = sql.join(likeConditions, sql` OR `);

        const catRows = await db.all<{ category: string; count: number }>(sql`
            SELECT ni.category, COUNT(*) as count
            FROM news_items ni
            WHERE ni.created_at >= datetime('now', '-' || ${hours} || ' hours')
              AND ni.is_deleted = 0
              AND (${fullCondition})
            GROUP BY ni.category
            ORDER BY count DESC
        `);
        const total = catRows.reduce((s, r) => s + r.count, 0);
        const categories = catRows.map(r => ({
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
    const db = getDb(c.env);
    try {
        const cutoff = shanghaiCutoff(hours);
        const rows = await db.select({
            keyword: trendingTopics.keyword,
            date_hour: trendingTopics.date_hour,
            count: trendingTopics.count,
        }).from(trendingTopics)
            .where(and(
                gte(trendingTopics.date_hour, cutoff),
                inArray(trendingTopics.keyword, keywords),
            ))
            .orderBy(trendingTopics.date_hour)
            .all();

        const series: Record<string, { date_hour: string; count: number }[]> = {};
        for (const row of rows) {
            if (!series[row.keyword]) series[row.keyword] = [];
            series[row.keyword].push({ date_hour: row.date_hour, count: row.count ?? 0 });
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
    const db = getDb(c.env);
    try {
        const [sourceRows, catRows] = await Promise.all([
            db.all<{ hour: string; source_id: number; source_name: string; count: number }>(sql`
                SELECT substr(ni.created_at,1,13) as hour, ni.source_id, s.name as source_name, COUNT(*) as count
                FROM news_items ni
                LEFT JOIN news_sources s ON ni.source_id = s.id
                WHERE ni.is_deleted = 0 AND ni.created_at > datetime('now', '-' || ${hours} || ' hours')
                GROUP BY hour, ni.source_id
                ORDER BY hour, count DESC
            `),
            db.all<{ hour: string; category: string; count: number }>(sql`
                SELECT substr(created_at,1,13) as hour, category, COUNT(*) as count
                FROM news_items
                WHERE is_deleted = 0 AND created_at > datetime('now', '-' || ${hours} || ' hours')
                GROUP BY hour, category
                ORDER BY hour, category
            `),
        ]);
        return c.json({ sources: sourceRows, categories: catRows });
    } catch (e: any) {
        console.error('Hourly stats error:', e);
        return c.json({ error: String(e) }, 500);
    }
});

// GET /trending/radar — Cloudflare Radar 全球互联网服务热度排行（跨源趋势补充）
trending.get('/trending/radar', async (c) => {
    const ranks = await fetchInternetServiceRanking(c.env);
    return c.json({ source: 'cloudflare-radar', ranks });
});

// 复用 /trending 的指数衰减聚合（半衰期 4 小时），返回 top N 关键词（word + count）
async function computeTopKeywords(env: Bindings, hours: number, limit = 8): Promise<{ word: string; count: number }[]> {
    const db = getDb(env);
    const cutoff = shanghaiCutoff(hours);
    const rows = await db.select({
        keyword: trendingTopics.keyword,
        date_hour: trendingTopics.date_hour,
        count: trendingTopics.count,
    }).from(trendingTopics)
        .where(gte(trendingTopics.date_hour, cutoff))
        .orderBy(desc(trendingTopics.date_hour))
        .limit(1000)
        .all();
    if (rows.length === 0) return [];

    const HALF_LIFE_HOURS = 4;
    const shanghaiNow = new Date(Date.now() + 8 * 3600 * 1000);
    const weighted = new Map<string, number>();
    for (const row of rows) {
        const rowDate = new Date(row.date_hour.replace(' ', 'T') + '+08:00');
        const ageHours = (shanghaiNow.getTime() - rowDate.getTime()) / 3600000;
        const w = Math.exp(-ageHours * Math.LN2 / HALF_LIFE_HOURS);
        weighted.set(row.keyword, (weighted.get(row.keyword) || 0) + (row.count ?? 0) * w);
    }
    return Array.from(weighted.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, limit)
        .map(([word, score]) => ({ word, count: Math.round(score) }));
}

// GET /trending/overview — AI 今日新闻格局概览（KV 缓存 30 分钟，避免重复消耗 AI 额度）
trending.get('/trending/overview', async (c) => {
    const hours = parseThemeHours(c.req.query('hours'));
    const cacheKey = `trending:overview:${hours}`;
    const now = new Date().toISOString();

    // 命中 KV 缓存直接返回
    if (c.env.KV) {
        try {
            const cached = await c.env.KV.get(cacheKey);
            if (cached) {
                const parsed = JSON.parse(cached);
                return c.json({ overview: parsed.overview ?? null, keywords: parsed.keywords || [], generated_at: parsed.generated_at || now });
            }
        } catch (e) {
            console.error('trending/overview cache read error:', e);
        }
    }

    try {
        const keywords = await computeTopKeywords(c.env, hours, 8);
        if (keywords.length === 0) {
            // 无趋势数据时不调用 AI，直接返回空概览（200 优雅降级）
            return c.json({ overview: null, keywords: [], generated_at: now });
        }

        const keywordList = keywords.map((k, i) => `${i + 1}. ${k.word}（热度 ${k.count}）`).join('\n');
        const prompt = `以下是最近 ${hours} 小时新闻趋势关键词及热度统计。请用 2-3 句中文概括"今日新闻格局"：哪些领域最热、有哪些显著变化。只输出正文，不要标题和编号。\n\n${keywordList}\n\n今日新闻格局：`;

        const overview = await callAI(c.env, prompt, { max_tokens: 200, temperature: 0.5 });
        const result = {
            overview: overview?.trim() || null,
            keywords,
            generated_at: now,
        };

        // 仅缓存成功的 AI 结果（TTL 1800 秒 = 30 分钟）
        if (c.env.KV && result.overview) {
            c.env.KV.put(cacheKey, JSON.stringify(result), { expirationTtl: 1800 }).catch(() => {});
        }
        return c.json(result);
    } catch (e) {
        console.error('trending/overview error:', e);
        // AI/DB 失败不 500，优雅降级
        return c.json({ overview: null, keywords: [], generated_at: now });
    }
});

// GET /trending/theme-perspectives — 主题多视角分析：FTS5 找相关报道 → generatePerspectives → callAI 兜底
trending.get('/trending/theme-perspectives', async (c) => {
    const keyword = (c.req.query('keyword') || '').trim();
    if (!keyword) return c.json({ error: '暂无该主题的多视角分析' }, 404);
    const hours = parseThemeHours(c.req.query('hours'));
    const db = getDb(c.env);

    try {
        // FTS5 匹配：复制 summarizer.findRelatedByFts 的 MATCH 模式（查询值限制为词字符，无注入风险）
        const safeKeyword = keyword.replace(/["']/g, ' ').trim();
        let items: { id: number; source: string; title: string }[] = [];
        if (safeKeyword) {
            const ftsQuery = `"${safeKeyword.replace(/"/g, '')}"`;
            try {
                const ftsIds = await db.all<{ rowid: number }>(
                    sql`SELECT rowid FROM news_fts WHERE news_fts MATCH ${sql.raw(`'${ftsQuery}'`)} LIMIT 30`
                );
                const matchedIds = ftsIds.map(r => r.rowid).slice(0, 5);
                if (matchedIds.length > 0) {
                    const rows = await db.all<any>(sql`
                        SELECT n.id, s.name as source_name, n.title
                        FROM news_items n LEFT JOIN news_sources s ON n.source_id = s.id
                        WHERE n.id IN (${sql.raw(matchedIds.join(','))}) AND n.is_deleted = 0
                          AND n.created_at >= datetime('now', '-' || ${hours} || ' hours')
                        ORDER BY COALESCE(n.published_at, n.created_at) DESC
                        LIMIT 5
                    `);
                    items = rows.map(r => ({ id: r.id, source: r.source_name || '未知', title: r.title }));
                }
            } catch (e) {
                console.error('theme-perspectives FTS error:', e);
            }
        }

        // FTS 无结果/不可用时，退化为 LIKE 匹配（转义风格同 /trending）
        if (items.length === 0 && safeKeyword) {
            const escaped = safeKeyword.replace(/[%_]/g, '=$&');
            const rows = await db.all<any>(sql`
                SELECT n.id, s.name as source_name, n.title
                FROM news_items n LEFT JOIN news_sources s ON n.source_id = s.id
                WHERE n.is_deleted = 0
                  AND n.created_at >= datetime('now', '-' || ${hours} || ' hours')
                  AND (n.title LIKE ${'%' + escaped + '%'} ESCAPE '=' OR n.description LIKE ${'%' + escaped + '%'} ESCAPE '=')
                ORDER BY COALESCE(n.published_at, n.created_at) DESC
                LIMIT 5
            `);
            items = rows.map(r => ({ id: r.id, source: r.source_name || '未知', title: r.title }));
        }

        if (items.length === 0) return c.json({ error: '暂无该主题的多视角分析' }, 404);

        // 首选第一条新闻的 generatePerspectives（跨媒体观点对比）
        const generated = await generatePerspectives(c.env, items[0].id);
        if (generated) {
            return c.json({
                keyword,
                perspective: generated.perspective,
                related: generated.related,
                generated_at: new Date().toISOString(),
            });
        }

        // 兜底：基于 top 5 标题让 AI 直接给出多视角分析
        const titles = items.map((it, i) => `${i + 1}. ${it.title}`).join('\n');
        const prompt = `以下是关于「${keyword}」的多篇新闻标题。请用 2-3 句中文给出多视角分析：不同报道关注的角度与立场差异。只输出正文，不要标题和编号。\n\n${titles}\n\n多视角分析：`;
        const perspective = await callAI(c.env, prompt, { max_tokens: 200, temperature: 0.5 });

        if (!perspective) return c.json({ error: '暂无该主题的多视角分析' }, 404);

        return c.json({
            keyword,
            perspective: perspective.trim(),
            related: items,
            generated_at: new Date().toISOString(),
        });
    } catch (e) {
        console.error('trending/theme-perspectives error:', e);
        // 兜底错误：保持 404 错误形态，绝不 500
        return c.json({ error: '暂无该主题的多视角分析' }, 404);
    }
});

export default trending;

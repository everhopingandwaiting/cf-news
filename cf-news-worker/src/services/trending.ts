import { Bindings } from '../types';
import { eq, sql, desc, and, like, gte } from 'drizzle-orm';
import { getDb } from '../db';
import { newsItems, stopWords, trendingTopics, newsSources } from '../db/schema';

// Asia/Shanghai hour bucket string "YYYY-MM-DD HH:00:00". trending_topics.date_hour
// is stored in Shanghai time so the 24h window aligns with the user's local day.
/** Return cutoff datetime string "YYYY-MM-DD HH:00:00" for N hours ago in Shanghai time. */
export function shanghaiCutoff(hoursAgo: number, now: Date = new Date()): string {
    const shanghaiTime = new Date(now.getTime() + 8 * 3600 * 1000 - hoursAgo * 3600 * 1000);
    const y = shanghaiTime.getFullYear();
    const m = String(shanghaiTime.getMonth() + 1).padStart(2, '0');
    const d = String(shanghaiTime.getDate()).padStart(2, '0');
    const h = String(shanghaiTime.getHours()).padStart(2, '0');
    return `${y}-${m}-${d} ${h}:00:00`;
}

export function shanghaiHourString(d: Date = new Date()): string {
    const shanghaiMs = d.getTime() + 8 * 3600 * 1000;
    return new Date(shanghaiMs).toISOString().substring(0, 19).replace('T', ' ');
}

export function normalizeKeyword(s: string): string {
    return s
        .trim()
        .toLowerCase()
        .replace(/[^\w\u4e00-\u9fff\s]/g, '')
        .replace(/\s+/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

export async function refreshTrendingTopics(env: Bindings): Promise<{ status: string; detail?: any }> {
    const db = getDb(env);
    try {
        const rows = await db.select({
            id: newsItems.id, title: newsItems.title,
            description: newsItems.description, createdAt: newsItems.created_at,
        }).from(newsItems)
            .where(and(
                eq(newsItems.is_deleted, 0),
                sql`created_at > datetime('now', '-1 day')`
            ))
            .orderBy(desc(newsItems.created_at))
            .limit(60)
            .all();

        if (rows.length < 3) {
            return { status: 'no_news', detail: { count: rows.length } };
        }

        const titles = rows.map(r => r.title);

        const stopRows = await db.select({ word: stopWords.word })
            .from(stopWords)
            .all();
        const stopSet = new Set(stopRows.map(r => normalizeKeyword(r.word)));

        const prompt = `分析以下新闻标题，提取当前最热门的10-15个话题/关键词。
要求：
- 英文全部用小写、单词间用下划线连接（如 ai_model、openai、gpt_5），便于程序归一
- 中文用 2-4 字短词或常见术语（如 量子计算、机器学习、苹果）
- 不要"AI"、"科技"、"公司"等过于通用的词
- 优先识别具体事件/产品/人物/技术名词
- 返回JSON数组，格式：[{"keyword":"..."}]，不要 count 字段
- 只返回JSON，不要其他文字

新闻标题：
${titles.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

        const resp = await env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
            messages: [
                { role: 'system', content: '你是一个新闻热点分析师。只返回JSON。' },
                { role: 'user', content: prompt },
            ],
            max_tokens: 4096,
        });
        const textRaw = (resp as any).response ?? (resp as any).choices?.[0]?.message?.content ?? '';
        const text = typeof textRaw === 'string' ? textRaw : JSON.stringify(textRaw);
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
            return { status: 'no_json', detail: { rawLen: text.length, rawHead: text.slice(0, 200), rawTail: text.slice(-200) } };
        }

        let raw: unknown;
        try { raw = JSON.parse(jsonMatch[0]); } catch (e) {
            return { status: 'json_parse_failed', detail: { match: jsonMatch[0].slice(0, 200) } };
        }
        if (!Array.isArray(raw)) {
            return { status: 'not_array', detail: { type: typeof raw } };
        }

        const seen = new Set<string>();
        const keywords: string[] = [];
        for (const item of raw) {
            if (!item || typeof (item as any).keyword !== 'string') continue;
            const norm = normalizeKeyword((item as any).keyword);
            if (norm.length < 2) continue;
            if (stopSet.has(norm)) continue;
            if (seen.has(norm)) continue;
            seen.add(norm);
            keywords.push(norm);
        }
        if (keywords.length === 0) {
            return { status: 'no_valid_keywords', detail: { llmCount: raw.length, sampleKeywords: raw.slice(0, 3), stopSetSize: stopSet.size } };
        }

        // Use raw SQL for batch counting with LIKE
        const countQueries = keywords.map(kw => env.DB.prepare(
            `SELECT COUNT(*) as c FROM news_items
             WHERE created_at > datetime('now', '+7 hours')
               AND created_at < datetime('now', '+8 hours')
               AND (title LIKE ? OR description LIKE ?)`
        ).bind(`%${kw}%`, `%${kw}%`));
        const countResults = await env.DB.batch(countQueries);
        const valid = keywords
            .map((kw, i) => ({ keyword: kw, count: Number(((countResults[i]?.results?.[0] as { c?: number } | undefined)?.c ?? 0)) }))
            .filter(t => t.count > 0)
            .slice(0, 20);
        if (valid.length === 0) {
            return { status: 'no_articles_matched', detail: { llmKeywords: keywords, countResults: countResults.slice(0, 3) } };
        }

        const dateHour = shanghaiHourString();
        await db.run(sql`DELETE FROM trending_topics WHERE date_hour = ${dateHour}`);
        for (const t of valid) {
            await db.run(sql`INSERT INTO trending_topics (keyword, date_hour, count) VALUES (${t.keyword}, ${dateHour}, ${t.count})`);
        }
        return { status: 'ok', detail: { dateHour, keywordsWritten: valid.length, sample: valid.slice(0, 5) } };
    } catch (e: any) {
        return { status: 'exception', detail: { message: e?.message || String(e), stack: e?.stack?.split('\n').slice(0, 3).join('\n') } };
    }
}

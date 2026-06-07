import { Bindings } from '../types';
import { eq, sql, desc, and } from 'drizzle-orm';
import { getDb } from '../db';
import { newsItems, newsSources, dailyDigests } from '../db/schema';

interface AISearchChunk {
    id: string;
    text: string;
    score: number;
    item?: { key?: string; metadata?: Record<string, any> };
}

interface DigestResult {
    id?: number;
    date: string;
    content: string;
    news_ids: number[];
    created_at?: string;
}

function getToday(): string {
    const now = new Date();
    const opts = { timeZone: 'Asia/Shanghai', year: 'numeric' as const, month: '2-digit' as const, day: '2-digit' as const };
    const parts = new Intl.DateTimeFormat('en-CA', opts).formatToParts(now);
    const y = parts.find(p => p.type === 'year')!.value;
    const m = parts.find(p => p.type === 'month')!.value;
    const d = parts.find(p => p.type === 'day')!.value;
    return `${y}-${m}-${d}`;
}

function getTodayStart(): string {
    const now = new Date();
    const opts = { timeZone: 'Asia/Shanghai', year: 'numeric' as const, month: '2-digit' as const, day: '2-digit' as const };
    const parts = new Intl.DateTimeFormat('en-CA', opts).formatToParts(now);
    const y = parts.find(p => p.type === 'year')!.value;
    const m = parts.find(p => p.type === 'month')!.value;
    const d = parts.find(p => p.type === 'day')!.value;
    return new Date(`${y}-${m}-${d}T00:00:00+08:00`).toISOString();
}

function hasAISearch(env: Bindings): boolean {
    return !!(env as any).AI_SEARCH;
}

function getSearchInstance(env: Bindings) {
    const aiSearch = (env as any).AI_SEARCH;
    if (!aiSearch) return null;
    return aiSearch;
}

async function wasUploaded(env: Bindings, newsId: number): Promise<boolean> {
    const db = getDb(env);
    const row = await db.select({ ai_search_uploaded: newsItems.ai_search_uploaded })
        .from(newsItems)
        .where(eq(newsItems.id, newsId))
        .get();
    return row?.ai_search_uploaded === 1;
}

async function markUploaded(env: Bindings, newsId: number): Promise<void> {
    const db = getDb(env);
    await db.update(newsItems)
        .set({ ai_search_uploaded: 1 })
        .where(eq(newsItems.id, newsId));
}

export async function askQuestion(
    env: Bindings,
    question: string,
    stream = false
): Promise<{ answer: string; chunks: any[] } | ReadableStream> {
    const db = getDb(env);
    const { callAI } = await import('./aiProvider');
    const recentNews = await db.select({
        title: newsItems.title, description: newsItems.description,
    }).from(newsItems)
        .where(eq(newsItems.is_deleted, 0))
        .orderBy(desc(newsItems.created_at))
        .limit(10)
        .all();

    const context = recentNews
        .map(n => `标题: ${n.title}\n内容: ${(n.description || '').substring(0, 200)}`)
        .join('\n---\n');

    const prompt = `以下是最近的新闻:\n${context}\n\n用户问题: ${question}\n\n请基于以上新闻回答问题。如果新闻内容不足以回答，请说明。`;

    if (stream) {
        try {
            const { callAIStream } = await import('./aiStream');
            const s = await callAIStream(env, prompt, {
                system_prompt: '你是一个新闻助手。回答简洁清晰，用中文。',
                max_tokens: 1000,
            });
            if (s) return s;
        } catch (e) {
            console.error('callAIStream exception:', e);
        }
    }

    const answer = await callAI(env, prompt, {
        system_prompt: '你是一个新闻助手。回答简洁清晰，用中文。',
        max_tokens: 1000,
    });

    return { answer: answer || '无法生成回答', chunks: [] };
}

export async function findRelated(
    env: Bindings,
    title: string,
    limit = 5
): Promise<AISearchChunk[]> {
    const instance = getSearchInstance(env);

    if (instance) {
        const results = await instance.search({
            messages: [{ role: 'user', content: title }],
            ai_search_options: {
                retrieval: { max_num_results: limit, retrieval_type: 'hybrid' },
            },
        });

        if (results?.chunks) {
            return results.chunks.map((chunk: any) => ({
                id: chunk.id,
                text: chunk.text,
                score: chunk.score || 0,
                item: chunk.item,
            }));
        }
        return [];
    }

    return [];
}

export async function getDailyDigest(env: Bindings, date?: string): Promise<DigestResult | null> {
    const db = getDb(env);
    const targetDate = date || getToday();
    const row = await db.select({
        id: dailyDigests.id, date: dailyDigests.date, content: dailyDigests.content,
        newsIds: dailyDigests.news_ids, createdAt: dailyDigests.created_at,
    }).from(dailyDigests)
        .where(eq(dailyDigests.date, targetDate))
        .get();

    if (row) {
        return {
            id: row.id,
            date: row.date,
            content: row.content,
            news_ids: JSON.parse(row.news_ids || '[]'),
            created_at: row.created_at ?? undefined,
        };
    }

    if (!date || date === getToday()) {
        return generateDailyDigest(env);
    }
    return null;
}

export async function listDigestDates(env: Bindings): Promise<string[]> {
    const db = getDb(env);
    const rows = await db.select({ date: dailyDigests.date })
        .from(dailyDigests)
        .orderBy(desc(dailyDigests.date))
        .limit(30)
        .all();
    return rows.map(r => r.date);
}

export async function generateDailyDigest(env: Bindings): Promise<DigestResult | null> {
    const db = getDb(env);
    const today = getToday();
    const sinceStr = getTodayStart();

    const news = await db.all<{ id: number; title: string; description: string | null; published_at: string | null; lang: string; source_name: string }>(sql`
        SELECT n.id, n.title, n.description, n.published_at, COALESCE(s.language, 'zh') as lang, COALESCE(s.name, '') as source_name
        FROM news_items n
        LEFT JOIN news_sources s ON n.source_id = s.id
        WHERE n.is_deleted = 0 AND (n.published_at >= ${sinceStr} OR n.published_at IS NULL)
        ORDER BY n.published_at DESC
    `);

    if (news.length === 0) return null;

    const newsIds = news.map(n => n.id);

    function fmtTime(published_at: string | null): string {
        if (!published_at) return '';
        try {
            const d = new Date(published_at);
            if (isNaN(d.getTime())) return '';
            const opts = { timeZone: 'Asia/Shanghai', hour: '2-digit' as const, minute: '2-digit' as const, hour12: false };
            const parts = new Intl.DateTimeFormat('en-CA', opts).formatToParts(d);
            const h = parts.find(p => p.type === 'hour')!.value;
            const m = parts.find(p => p.type === 'minute')!.value;
            return `${h}:${m}`;
        } catch { return ''; }
    }
    function langTag(lang: string): string { return lang === 'zh' ? 'CN' : 'EN'; }

    const instance = getSearchInstance(env);

    const enItems = news.filter(n => n.lang !== 'zh').map((n, i) => ({ idx: news.indexOf(n), title: n.title }));
    const enTranslations = new Map<number, string>();

    if (enItems.length > 0 && instance) {
        const translatePrompt = `将以下英文新闻标题翻译为中文，只返回翻译结果，每行一条:\n${enItems.map((n, i) => `${i + 1}. ${n.title}`).join('\n')}`;
        try {
            const resp = await instance.chatCompletions({
                messages: [
                    { role: 'system', content: '将英文新闻标题翻译为简洁的中文标题。只返回翻译结果，不要序号。' },
                    { role: 'user', content: translatePrompt },
                ],
                model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
            });
            const text = resp.choices?.[0]?.message?.content || '';
            text.trim().split('\n').filter((l: string) => l.trim()).forEach((line: string, i: number) => {
                if (i < enItems.length) enTranslations.set(enItems[i].idx, line.replace(/^\d+[\.\s]+/, '').trim());
            });
        } catch {}
    }

    const content = news.map((n, i) => {
        const t = fmtTime(n.published_at);
        const lang = langTag(n.lang);
        const src = n.source_name ? ` (${n.source_name})` : '';
        const translated = enTranslations.get(i);
        if (lang === 'EN') {
            const desc = translated || `[英] ${n.title}`;
            return `${i + 1}. **${n.title}** [${lang}]${t ? ' ' + t : ''}${src}\n${desc}`;
        }
        return `${i + 1}. **${n.title}** [${lang}]${t ? ' ' + t : ''}${src}`;
    }).join('\n\n');

    await db.run(sql`INSERT OR REPLACE INTO daily_digests (date, content, news_ids) VALUES (${today}, ${content}, ${JSON.stringify(newsIds)})`);

    return { date: today, content, news_ids: newsIds };
}

export async function uploadNewsItem(
    env: Bindings,
    item: { id: number; title: string; description?: string; content?: string; category?: string; published_at?: string }
): Promise<boolean> {
    const instance = getSearchInstance(env);
    if (!instance) return false;

    if (await wasUploaded(env, item.id)) return true;

    try {
        const body = (item.description || item.content || '')
            .replace(/<[^>]+>/g, '')
            .trim()
            .substring(0, 8000);

        const text = body ? `# ${item.title}\n\n${body}` : `# ${item.title}`;

        await instance.items.upload(`news-${item.id}.md`, text, {
            metadata: {
                news_id: String(item.id),
                category: item.category || 'general',
                published_at: item.published_at || '',
            },
        });

        await markUploaded(env, item.id);
        return true;
    } catch (e) {
        console.error(`AI Search upload failed for news-${item.id}:`, e);
        return false;
    }
}

import { Bindings } from '../types';

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
    // 使用 Asia/Shanghai 时区
    const opts = { timeZone: 'Asia/Shanghai', year: 'numeric' as const, month: '2-digit' as const, day: '2-digit' as const };
    const parts = new Intl.DateTimeFormat('en-CA', opts).formatToParts(now);
    const y = parts.find(p => p.type === 'year')!.value;
    const m = parts.find(p => p.type === 'month')!.value;
    const d = parts.find(p => p.type === 'day')!.value;
    return `${y}-${m}-${d}`;
}

function getTodayStart(): string {
    // 当天 00:00:00 Asia/Shanghai 转 UTC
    const now = new Date();
    const opts = { timeZone: 'Asia/Shanghai', year: 'numeric' as const, month: '2-digit' as const, day: '2-digit' as const };
    const parts = new Intl.DateTimeFormat('en-CA', opts).formatToParts(now);
    const y = parts.find(p => p.type === 'year')!.value;
    const m = parts.find(p => p.type === 'month')!.value;
    const d = parts.find(p => p.type === 'day')!.value;
    return new Date(`${y}-${m}-${d}T00:00:00+08:00`).toISOString();
}

const AI_SEARCH_PREFIX = 'ai_search:uploaded:';

function hasAISearch(env: Bindings): boolean {
    return !!(env as any).AI_SEARCH;
}

function getSearchInstance(env: Bindings) {
    const aiSearch = (env as any).AI_SEARCH;
    if (!aiSearch) return null;
    return aiSearch;
}

async function wasUploaded(env: Bindings, newsId: number): Promise<boolean> {
    const row = await env.DB.prepare(
        'SELECT ai_search_uploaded FROM news_items WHERE id = ?'
    ).bind(newsId).first<{ ai_search_uploaded: number }>();
    return row?.ai_search_uploaded === 1;
}

async function markUploaded(env: Bindings, newsId: number): Promise<void> {
    await env.DB.prepare(
        'UPDATE news_items SET ai_search_uploaded = 1 WHERE id = ?'
    ).bind(newsId).run();
}

export async function askQuestion(
    env: Bindings,
    question: string,
    stream = false
): Promise<{ answer: string; chunks: any[] } | ReadableStream> {
    const { callAI } = await import('./aiProvider');
    const recentNews = await env.DB.prepare(
        `SELECT title, description FROM news_items WHERE is_deleted = 0 ORDER BY created_at DESC LIMIT 10`
    ).all<{ title: string; description: string }>();

    const context = recentNews.results
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

    // Fallback: query D1 for similar category news
    return [];
}

export async function getDailyDigest(env: Bindings, date?: string): Promise<DigestResult | null> {
    const targetDate = date || getToday();
    const row = await env.DB.prepare(
        'SELECT id, date, content, news_ids, created_at FROM daily_digests WHERE date = ?'
    ).bind(targetDate).first<{ id: number; date: string; content: string; news_ids: string; created_at: string }>();

    if (row) {
        return {
            id: row.id,
            date: row.date,
            content: row.content,
            news_ids: JSON.parse(row.news_ids || '[]'),
            created_at: row.created_at,
        };
    }

    // Only auto-generate for today
    if (!date || date === getToday()) {
        return generateDailyDigest(env);
    }
    return null;
}

export async function listDigestDates(env: Bindings): Promise<string[]> {
    const rows = await env.DB.prepare(
        'SELECT date FROM daily_digests ORDER BY date DESC LIMIT 30'
    ).all<{ date: string }>();
    return rows.results.map(r => r.date);
}

export async function generateDailyDigest(env: Bindings): Promise<DigestResult | null> {
    const today = getToday();

    // Fetch all news published today in Asia/Shanghai timezone
    const sinceStr = getTodayStart();

    const news = await env.DB.prepare(
        `SELECT n.id, n.title, n.description, n.published_at, COALESCE(s.language, 'zh') as lang, COALESCE(s.name, '') as source_name
         FROM news_items n
         LEFT JOIN news_sources s ON n.source_id = s.id
         WHERE n.is_deleted = 0 AND (n.published_at >= ? OR n.published_at IS NULL)
         ORDER BY n.published_at DESC`
    ).bind(sinceStr).all<{ id: number; title: string; description: string; published_at: string; lang: string; source_name: string }>();

    if (news.results.length === 0) {
        return null;
    }

    const newsIds = news.results.map(n => n.id);
    function fmtTime(published_at: string): string {
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

    const newsText = news.results
        .map(n => `来源: ${n.source_name}\t语言: ${langTag(n.lang)}\t时间: ${fmtTime(n.published_at)}\n标题: ${n.title}\n内容: ${(n.description || '').substring(0, 300)}`)
        .join('\n---\n');

    const instance = getSearchInstance(env);

    // Only ask AI to translate English titles (shorter task, more reliable)
    const enItems = news.results.filter(n => n.lang !== 'zh').map((n, i) => ({ idx: news.results.indexOf(n), title: n.title }));
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
            text.trim().split('\n').filter(l => l.trim()).forEach((line, i) => {
                if (i < enItems.length) enTranslations.set(enItems[i].idx, line.replace(/^\d+[\.\s]+/, '').trim());
            });
        } catch {}
    }

    // Build content server-side with guaranteed times, translated titles, and source info
    const content = news.results.map((n, i) => {
        const t = fmtTime(n.published_at);
        const lang = langTag(n.lang);
        const src = n.source_name ? ` (${n.source_name})` : '';
        const translated = enTranslations.get(i);
        // For Chinese items: no extra line (title already shown above)
        // For English items: show Chinese translation
        if (lang === 'EN') {
            const desc = translated || `[英] ${n.title}`;
            return `${i + 1}. **${n.title}** [${lang}]${t ? ' ' + t : ''}${src}\n${desc}`;
        }
        return `${i + 1}. **${n.title}** [${lang}]${t ? ' ' + t : ''}${src}`;
    }).join('\n\n');

    // Save to D1
    await env.DB.prepare(
        'INSERT OR REPLACE INTO daily_digests (date, content, news_ids) VALUES (?, ?, ?)'
    ).bind(today, content, JSON.stringify(newsIds)).run();

    return { date: today, content, news_ids: newsIds };
}

export async function uploadNewsItem(
    env: Bindings,
    item: { id: number; title: string; description?: string; content?: string; category?: string; published_at?: string }
): Promise<boolean> {
    const instance = getSearchInstance(env);
    if (!instance) return false;

    // Skip if already uploaded (KV dedup)
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
        // Don't mark as uploaded on failure, will retry next cycle
        return false;
    }
}

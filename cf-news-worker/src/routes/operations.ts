import { Hono } from 'hono';
import { Bindings } from '../types';
import { fetchNews } from '../services/newsFetcher';
import { generateSummaryForNews, generateBatchSummariesForNews, generateAITake } from '../services/summarizer';
import { translateText } from '../services/translator';

const operations = new Hono<{ Bindings: Bindings }>();

// POST /api/fetch — manually trigger news fetch
operations.post('/fetch', async (c) => {
    const row = await c.env.DB.prepare("SELECT value FROM app_config WHERE key = 'last_fetch_time'").first<{ value: string }>();
    const lastFetch = row?.value;
    const now = Date.now();
    if (lastFetch && (now - parseInt(lastFetch)) < 300000) {
        const remaining = Math.ceil((300000 - (now - parseInt(lastFetch))) / 1000);
        return c.json({ success: false, error: `冷却中，请 ${remaining} 秒后再试` }, 429);
    }
    try {
        await fetchNews(c.env, true);
        await c.env.DB.prepare("INSERT OR REPLACE INTO app_config (key, value) VALUES ('last_fetch_time', ?)").bind(String(now)).run();
        return c.json({ success: true, message: 'News fetch triggered' });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// POST /api/summarize — generate summaries for items without them
operations.post('/summarize', async (c) => {
    try {
        const body = await c.req.json().catch(() => ({}));
        const ids = body?.ids as number[] | undefined;

        let items: any;
        if (ids && ids.length > 0) {
            const placeholders = ids.map(() => '?').join(',');
            items = await c.env.DB.prepare(
                `SELECT id, title, description, content FROM news_items WHERE id IN (${placeholders})`
            ).bind(...ids).all<{ id: number; title: string; description: string; content: string }>();
        } else {
            items = await c.env.DB.prepare(
                `SELECT n.id, n.title, n.description, n.content 
                 FROM news_items n LEFT JOIN news_summaries ns ON ns.news_id = n.id 
                 WHERE ns.id IS NULL AND (n.description IS NOT NULL OR n.content IS NOT NULL)
                 LIMIT 10`
            ).all<{ id: number; title: string; description: string; content: string }>();
        }

        const done = await generateBatchSummariesForNews(c.env, items.results);
        return c.json({ success: true, generated: done, total: items.results.length });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// POST /api/summarize/:newsId — generate summary for a single news item
operations.post('/summarize/:newsId', async (c) => {
    const newsId = parseInt(c.req.param('newsId'));
    try {
        const item = await c.env.DB.prepare(
            'SELECT id, title, description, content FROM news_items WHERE id = ?'
        ).bind(newsId).first<{ id: number; title: string; description: string; content: string }>();
        if (!item) return c.json({ success: false, error: '新闻不存在' }, 404);
        const existing = await c.env.DB.prepare('SELECT id FROM news_summaries WHERE news_id = ?').bind(newsId).first();
        if (existing) {
            return c.json({ success: true, generated: 0, skipped: true });
        }

        const ok = await generateSummaryForNews(c.env, newsId, item);
        return c.json({ success: true, generated: ok ? 1 : 0 });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// POST /api/take/:newsId — generate AI take (吐槽) for a news item (synchronous)
operations.post('/take/:newsId', async (c) => {
    const newsId = parseInt(c.req.param('newsId'));
    try {
        const item = await c.env.DB.prepare(
            'SELECT id, title, description, content FROM news_items WHERE id = ?'
        ).bind(newsId).first<{ id: number; title: string; description: string; content: string }>();
        if (!item) return c.json({ success: false, error: '新闻不存在' }, 404);
        await generateAITake(c.env, newsId, item);
        const row = await c.env.DB.prepare('SELECT take FROM news_ai_take WHERE news_id = ?').bind(newsId).first<{ take: string }>();
        return c.json({ success: true, take: row?.take || null });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// POST /api/summarize/clear — delete all summaries
operations.post('/summarize/clear', async (c) => {
    try {
        await c.env.DB.prepare('DELETE FROM news_summaries').run();
        return c.json({ success: true, message: '所有摘要已清空' });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// POST /api/translate — translate text
operations.post('/translate', async (c) => {
    try {
        const { text, lang } = await c.req.json();
        if (!text || !lang) return c.json({ error: 'Missing text or lang' }, 400);
        const translated = await translateText(c.env, text, lang);
        if (!translated) return c.json({ error: 'Translation failed' }, 500);
        return c.json({ translated });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

export default operations;

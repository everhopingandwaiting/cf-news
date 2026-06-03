import { Hono } from 'hono';
import { Bindings } from '../types';
import { askQuestion, findRelated, getDailyDigest, generateDailyDigest, listDigestDates } from '../services/aiSearch';
import { verifyJWT } from './auth';

const router = new Hono<{ Bindings: Bindings }>();

// News Q&A
router.post('/ask', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: '请先登录' }, 401);
    }
    const payload = await verifyJWT(authHeader.substring(7), c.env.JWT_SECRET);
    if (!payload) {
        return c.json({ error: '登录已过期' }, 401);
    }

    try {
        const { question, stream } = await c.req.json();
        if (!question || typeof question !== 'string') {
            return c.json({ error: '请输入问题' }, 400);
        }
        if (question.length > 500) {
            return c.json({ error: '问题太长，请控制在500字以内' }, 400);
        }

        const result = await askQuestion(c.env, question, stream === true);

        if (result instanceof ReadableStream) {
            return new Response(result, {
                headers: {
                    'Content-Type': 'text/event-stream',
                    'Cache-Control': 'no-cache',
                    'Connection': 'keep-alive',
                },
            });
        }

        return c.json({ answer: result.answer, chunks: result.chunks });
    } catch (error) {
        return c.json({ error: '问答生成失败', detail: String(error) }, 500);
    }
});

// Get digest (today or by date)
router.get('/digest', async (c) => {
    try {
        const date = c.req.query('date');
        const digest = await getDailyDigest(c.env, date);
        return c.json({ digest: digest || null });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// List available digest dates
router.get('/digest/dates', async (c) => {
    try {
        const dates = await listDigestDates(c.env);
        return c.json({ dates });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// Force regenerate digest (admin only)
router.post('/digest/generate', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    const payload = await verifyJWT(authHeader.substring(7), c.env.JWT_SECRET);
    if (!payload || !payload.sub) {
        return c.json({ error: '无权限' }, 403);
    }

    try {
        const digest = await generateDailyDigest(c.env);
        return c.json({ success: true, digest });
    } catch (error) {
        return c.json({ success: false, error: String(error) }, 500);
    }
});

// Related articles
router.get('/related/:id', async (c) => {
    try {
        const id = parseInt(c.req.param('id'));
        if (isNaN(id)) return c.json({ error: 'Invalid id' }, 400);

        // Get the news item
        const item = await c.env.DB.prepare(
            'SELECT id, title, category FROM news_items WHERE id = ? AND is_deleted = 0'
        ).bind(id).first<{ id: number; title: string; category: string }>();

        if (!item) return c.json({ error: 'News not found' }, 404);

        // Try AI Search first
        const aiRelated = await findRelated(c.env, item.title, 5);

        if (aiRelated.length > 0) {
            return c.json({ related: aiRelated });
        }

        // Fallback: keyword matching via LIKE (more robust than FTS5 MATCH)
        let related: any[] = [];
        const keywords = item.title
            .replace(/[^\w\u4e00-\u9fff\s]/g, ' ')
            .split(/\s+/)
            .filter(w => w.length > 1 && !['the','a','an','is','of','to','in','for','on','and','or','by','at','it','as','be','this','that','with','from'].includes(w.toLowerCase()))
            .slice(0, 3);
        if (keywords.length > 0) {
            const likeClauses = keywords.map(() => `title LIKE ?`).join(' OR ');
            const params = keywords.map(k => `%${k}%`);
            const like = await c.env.DB.prepare(
                `SELECT id, title, description, image_url, published_at
                 FROM news_items
                 WHERE (${likeClauses}) AND id != ? AND is_deleted = 0
                 ORDER BY
                   CASE WHEN category = ? THEN 0 ELSE 1 END,
                   created_at DESC
                 LIMIT 5`
            ).bind(...params, id, item.category).all<any>();
            related = like.results;
        }
        if (related.length === 0) {
            const sameCat = await c.env.DB.prepare(
                `SELECT id, title, description, image_url, published_at
                 FROM news_items
                 WHERE category = ? AND id != ? AND is_deleted = 0
                 ORDER BY created_at DESC LIMIT 5`
            ).bind(item.category, id).all<any>();
            related = sameCat.results;
        }

        return c.json({
            related: related.map((n: any) => ({
                id: String(n.id),
                text: n.title,
                score: 0.5,
                item: { metadata: { description: n.description, image_url: n.image_url } },
            })),
        });
    } catch (error) {
        return c.json({ error: String(error) }, 500);
    }
});

// POST /trending/insight — AI-generated explanation for why a keyword is trending.
router.post('/trending/insight', async (c) => {
    try {
        const { keyword, hours } = await c.req.json<{ keyword: string; hours?: number }>();
        if (!keyword || typeof keyword !== 'string') {
            return c.json({ error: '请输入关键词' }, 400);
        }
        const period = hours || 24;

        // Fetch recent news items matching this keyword
        const escaped = keyword.replace(/[%_]/g, '=$&');
        const newsRows = await c.env.DB.prepare(`
            SELECT n.title, n.description, ns.name as source_name, n.published_at
            FROM news_items n
            LEFT JOIN news_sources ns ON n.source_id = ns.id
            WHERE n.created_at >= datetime('now', '-' || ? || ' hours')
              AND n.is_deleted = 0
              AND (n.title LIKE ? ESCAPE '=' OR n.description LIKE ? ESCAPE '=')
            ORDER BY n.published_at DESC
            LIMIT 8
        `).bind(period, `%${escaped}%`, `%${escaped}%`).all<{
            title: string; description: string; source_name: string; published_at: string;
        }>();

        if (newsRows.results.length === 0) {
            return c.json({ insight: `近期没有找到与"${keyword}"相关的新闻报道。` });
        }

        const articles = newsRows.results.map((r, i) =>
            `标题: ${r.title}\n来源: ${r.source_name || '未知'}\n摘要: ${(r.description || '').substring(0, 200)}`
        ).join('\n---\n');

        const messages = [
            { role: 'system', content: '你是一个新闻趋势分析师。用简洁的中文分析关键词走红原因，不超过100字。' },
            { role: 'user', content: `以下是关于"${keyword}"的近期新闻报道。请用中文给出1-2句话的分析，解释为什么这个词最近很热门，指出主要原因或事件。语气简洁客观。\n\n${articles}\n\n分析:` },
        ];

        // Try providers in order: groq → cloudflare → openrouter → nvidia
        // Read provider order from app_config
        const orderRow = await c.env.DB.prepare("SELECT value FROM app_config WHERE key = 'provider_order'").first<{ value: string }>();
        const order = orderRow ? orderRow.value.split(',').map(s => s.trim()) : ['groq', 'cloudflare', 'openrouter', 'nvidia'];

        let insight = '';
        for (const provider of order) {
            if (provider === 'cloudflare') {
                try {
                    const resp = await c.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', { messages, max_tokens: 300 });
                    insight = (resp as any).response || (resp as any).choices?.[0]?.message?.content || '';
                    if (insight) break;
                } catch { continue; }
            } else {
                const provRow = await c.env.DB.prepare(
                    'SELECT base_url, api_key_env FROM providers WHERE name = ? AND enabled = 1'
                ).bind(provider).first<{ base_url: string; api_key_env: string }>();
                if (!provRow || !provRow.api_key_env) continue;
                const apiKey = (c.env as any)[provRow.api_key_env];
                if (!apiKey) continue;

                const modelRow = await c.env.DB.prepare(
                    'SELECT model_id FROM provider_models WHERE provider = ? AND enabled = 1 ORDER BY score DESC LIMIT 1'
                ).bind(provider).first<{ model_id: string }>();
                if (!modelRow) continue;

                try {
                    const baseUrl = provRow.base_url.endsWith('/') ? provRow.base_url : provRow.base_url + '/';
                    const res = await fetch(`${baseUrl}chat/completions`, {
                        method: 'POST',
                        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ model: modelRow.model_id, messages, max_tokens: 300 }),
                        signal: AbortSignal.timeout(20000),
                    });
                    if (!res.ok) continue;
                    const body: any = await res.json();
                    insight = body?.choices?.[0]?.message?.content || '';
                    if (insight) break;
                } catch { continue; }
            }
        }

        return c.json({ insight: insight.trim() || `未找到关于"${keyword}"的充分分析数据。` });
    } catch (error) {
        return c.json({ error: '生成分析失败', detail: String(error) }, 500);
    }
});

export default router;

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
    if (!payload || payload.sub !== 1) {
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

export default router;

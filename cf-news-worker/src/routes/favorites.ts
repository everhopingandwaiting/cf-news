import { Hono } from 'hono';
import { Bindings } from '../types';
import { verifyJWT } from './auth';

const favorites = new Hono<{ Bindings: Bindings }>();

async function getUserId(c: any): Promise<number | null> {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7);
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    return payload?.sub || null;
}

// Get user favorites
favorites.get('/', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const offset = (page - 1) * limit;

    try {
        const result = await c.env.DB.prepare(`
            SELECT n.*, s.name as source_name, f.created_at as favorited_at
            FROM user_favorites f
            JOIN news_items n ON f.news_id = n.id
            LEFT JOIN news_sources s ON n.source_id = s.id
            WHERE f.user_id = ?
            ORDER BY f.created_at DESC
            LIMIT ? OFFSET ?
        `).bind(userId, limit, offset).all();

        const countResult = await c.env.DB.prepare(
            'SELECT COUNT(*) as total FROM user_favorites WHERE user_id = ?'
        ).bind(userId).first();

        const total = (countResult as any)?.total || 0;

        return c.json({
            favorites: result.results,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    } catch (error) {
        console.error('Error fetching favorites:', error);
        return c.json({ error: '获取收藏失败' }, 500);
    }
});

// Export favorites as Markdown
favorites.get('/export', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    try {
        const result = await c.env.DB.prepare(`
            SELECT n.title, n.url, n.description, ns.summary as ai_summary, s.name as source_name, n.category, n.published_at, f.created_at as favorited_at
            FROM user_favorites f
            JOIN news_items n ON f.news_id = n.id
            LEFT JOIN news_sources s ON n.source_id = s.id
            LEFT JOIN news_summaries ns ON ns.news_id = n.id
            WHERE f.user_id = ? AND f.is_deleted = 0
            ORDER BY f.created_at DESC
        `).bind(userId).all();

        const items = result.results as any[];
        const now = new Date().toISOString().split('T')[0];
        let md = `# 我的收藏\n\n导出时间: ${now} | 共 ${items.length} 条\n\n---\n\n`;

        const categories: Record<string, any[]> = {};
        for (const item of items) {
            const cat = item.category || '未分类';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(item);
        }

        for (const [cat, catItems] of Object.entries(categories)) {
            md += `## ${cat}\n\n`;
            for (const item of catItems) {
                md += `### ${item.title}\n\n`;
                md += `- 来源: ${item.source_name || '未知'}\n`;
                md += `- 链接: ${item.url}\n`;
                if (item.published_at) md += `- 发布: ${item.published_at}\n`;
                md += `- 收藏: ${item.favorited_at}\n`;
                if (item.ai_summary) md += `\n> ${item.ai_summary}\n`;
                md += `\n`;
            }
        }

        return new Response(md, {
            headers: {
                'Content-Type': 'text/markdown; charset=utf-8',
                'Content-Disposition': `attachment; filename="favorites-${now}.md"`,
            },
        });
    } catch (error) {
        console.error('Error exporting favorites:', error);
        return c.json({ error: '导出失败' }, 500);
    }
});

// Add favorite
favorites.post('/:newsId', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    const newsId = parseInt(c.req.param('newsId'));
    try {
        await c.env.DB.prepare(
            'INSERT OR IGNORE INTO user_favorites (user_id, news_id) VALUES (?, ?)'
        ).bind(userId, newsId).run();
        return c.json({ message: '收藏成功' }, 201);
    } catch (error) {
        console.error('Error adding favorite:', error);
        return c.json({ error: '收藏失败' }, 500);
    }
});

// Remove favorite
favorites.delete('/:newsId', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    const newsId = parseInt(c.req.param('newsId'));
    try {
        await c.env.DB.prepare(
            'DELETE FROM user_favorites WHERE user_id = ? AND news_id = ?'
        ).bind(userId, newsId).run();
        return c.json({ message: '取消收藏成功' });
    } catch (error) {
        console.error('Error removing favorite:', error);
        return c.json({ error: '取消收藏失败' }, 500);
    }
});

export default favorites;

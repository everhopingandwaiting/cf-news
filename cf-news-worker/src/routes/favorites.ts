import { Hono } from 'hono';
import { Bindings } from '../types';
import { verifyJWT } from './auth';
import { eq, desc, count, and, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { userFavorites } from '../db/schema';
import { fetchNewsBundle } from '../services/archive';

const favorites = new Hono<{ Bindings: Bindings }>();

async function getUserId(c: any): Promise<number | null> {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return null;
    const token = authHeader.substring(7);
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    return payload?.sub || null;
}

favorites.get('/', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    const page = parseInt(c.req.query('page') || '1');
    const limit = parseInt(c.req.query('limit') || '20');
    const offset = (page - 1) * limit;

    try {
        const db = getDb(c.env);
        // 冷热分库：先在用户表上分页+计数（不依赖 news 所在侧），再批量水合新闻
        //（主库优先、缺失补归档）——原 INNER JOIN 单库写法在驱逐后会丢归档行。
        const favRows = await db.select({
            news_id: userFavorites.news_id,
            favorited_at: userFavorites.created_at,
        })
            .from(userFavorites)
            .where(eq(userFavorites.user_id, userId))
            .orderBy(desc(userFavorites.created_at))
            .limit(limit)
            .offset(offset);

        const bundle = await fetchNewsBundle(c.env, favRows.map(r => r.news_id), {
            withSummary: false, withTake: false,
        });
        const favorites = favRows
            .filter(r => bundle.has(r.news_id))
            .map(r => ({ ...bundle.get(r.news_id), favorited_at: r.favorited_at }));

        const countResult = await db.select({ total: count() })
            .from(userFavorites)
            .where(eq(userFavorites.user_id, userId))
            .get();

        const total = countResult?.total || 0;

        return c.json({
            favorites,
            pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
        });
    } catch (error) {
        console.error('Error fetching favorites:', error);
        return c.json({ error: '获取收藏失败' }, 500);
    }
});

favorites.get('/export', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    try {
        const db = getDb(c.env);
        // 冷热分库：用户表全量取行 → 批量水合（含摘要，导出需要 aiSummary）
        const favRows = await db.select({
            news_id: userFavorites.news_id,
            favorited_at: userFavorites.created_at,
        })
            .from(userFavorites)
            .where(and(eq(userFavorites.user_id, userId), eq(userFavorites.is_deleted, 0)))
            .orderBy(desc(userFavorites.created_at));

        const bundle = await fetchNewsBundle(c.env, favRows.map(r => r.news_id), { withTake: false });
        const items = favRows
            .filter(r => bundle.has(r.news_id))
            .map(r => {
                const n = bundle.get(r.news_id);
                return {
                    title: n.title,
                    url: n.url,
                    description: n.description,
                    aiSummary: n.ai_summary || null,
                    sourceName: n.source_name || null,
                    category: n.category,
                    published_at: n.published_at,
                    favorited_at: r.favorited_at,
                };
            });

        const now = new Date().toISOString().split('T')[0];
        let md = `# 我的收藏\n\n导出时间: ${now} | 共 ${items.length} 条\n\n---\n\n`;

        const categories: Record<string, typeof items> = {};
        for (const item of items) {
            const cat = item.category || '未分类';
            if (!categories[cat]) categories[cat] = [];
            categories[cat].push(item);
        }

        for (const [cat, catItems] of Object.entries(categories)) {
            md += `## ${cat}\n\n`;
            for (const item of catItems) {
                md += `### ${item.title}\n\n`;
                md += `- 来源: ${item.sourceName || '未知'}\n`;
                md += `- 链接: ${item.url}\n`;
                if (item.published_at) md += `- 发布: ${item.published_at}\n`;
                md += `- 收藏: ${item.favorited_at}\n`;
                if (item.aiSummary) md += `\n> ${item.aiSummary}\n`;
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

favorites.post('/:newsId', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    const newsId = parseInt(c.req.param('newsId'));
    try {
        const db = getDb(c.env);
        await db.insert(userFavorites).values({ user_id: userId, news_id: newsId }).onConflictDoNothing();
        return c.json({ message: '收藏成功' }, 201);
    } catch (error) {
        console.error('Error adding favorite:', error);
        return c.json({ error: '收藏失败' }, 500);
    }
});

favorites.delete('/:newsId', async (c) => {
    const userId = await getUserId(c);
    if (!userId) return c.json({ error: '未授权' }, 401);

    const newsId = parseInt(c.req.param('newsId'));
    try {
        const db = getDb(c.env);
        await db.delete(userFavorites)
            .where(and(eq(userFavorites.user_id, userId), eq(userFavorites.news_id, newsId)));
        return c.json({ message: '取消收藏成功' });
    } catch (error) {
        console.error('Error removing favorite:', error);
        return c.json({ error: '取消收藏失败' }, 500);
    }
});

export default favorites;

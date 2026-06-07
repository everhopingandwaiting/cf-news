import { Hono } from 'hono';
import { Bindings } from '../types';
import { verifyJWT } from './auth';
import { eq, desc, count, and, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { userFavorites, newsItems, newsSources, newsSummaries } from '../db/schema';

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
        const result = await db.select({
            id: newsItems.id,
            source_id: newsItems.source_id,
            title: newsItems.title,
            url: newsItems.url,
            description: newsItems.description,
            content: newsItems.content,
            image_url: newsItems.image_url,
            category: newsItems.category,
            published_at: newsItems.published_at,
            is_deleted: newsItems.is_deleted,
            created_at: newsItems.created_at,
            source_name: newsSources.name,
            favorited_at: userFavorites.created_at,
        })
            .from(userFavorites)
            .innerJoin(newsItems, eq(userFavorites.news_id, newsItems.id))
            .leftJoin(newsSources, eq(newsItems.source_id, newsSources.id))
            .where(eq(userFavorites.user_id, userId))
            .orderBy(desc(userFavorites.created_at))
            .limit(limit)
            .offset(offset);

        const countResult = await db.select({ total: count() })
            .from(userFavorites)
            .where(eq(userFavorites.user_id, userId))
            .get();

        const total = countResult?.total || 0;

        return c.json({
            favorites: result,
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
        const items = await db.select({
            title: newsItems.title,
            url: newsItems.url,
            description: newsItems.description,
            aiSummary: newsSummaries.summary,
            sourceName: newsSources.name,
            category: newsItems.category,
            published_at: newsItems.published_at,
            favorited_at: userFavorites.created_at,
        })
            .from(userFavorites)
            .innerJoin(newsItems, eq(userFavorites.news_id, newsItems.id))
            .leftJoin(newsSources, eq(newsItems.source_id, newsSources.id))
            .leftJoin(newsSummaries, eq(newsSummaries.news_id, newsItems.id))
            .where(and(eq(userFavorites.user_id, userId), eq(userFavorites.is_deleted, 0)))
            .orderBy(desc(userFavorites.created_at));

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
                md += `- 收藏: ${item.favoritedAt}\n`;
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

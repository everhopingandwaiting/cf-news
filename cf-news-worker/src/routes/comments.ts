import { Hono } from 'hono';
import { Bindings } from '../types';

const comments = new Hono<{ Bindings: Bindings }>();

comments.get('/:newsId', async (c) => {
    const newsId = c.req.param('newsId');
    const result = await c.env.DB.prepare(`
        SELECT nc.*, u.username 
        FROM news_comments nc 
        JOIN users u ON nc.user_id = u.id 
        WHERE nc.news_id = ? AND nc.is_deleted = 0
        ORDER BY nc.created_at DESC
    `).bind(newsId).all();
    return c.json({ comments: result.results });
});

comments.post('/:newsId', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return c.json({ error: 'Unauthorized' }, 401);
    
    try {
        const token = authHeader.replace('Bearer ', '');
        const payload = JSON.parse(atob(token.split('.')[1]));
        const newsId = c.req.param('newsId');
        const { content } = await c.req.json();
        
        if (!content || content.trim().length === 0) {
            return c.json({ error: 'Content required' }, 400);
        }
        
        await c.env.DB.prepare(`
            INSERT INTO news_comments (news_id, user_id, content, created_at) VALUES (?, ?, ?, datetime('now', '+8 hours'))
        `).bind(newsId, payload.sub, content).run();
        
        return c.json({ success: true });
    } catch (e) {
        console.error('Comment error:', e);
        return c.json({ error: 'Invalid token' }, 401);
    }
});

comments.delete('/:commentId', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader) return c.json({ error: 'Unauthorized' }, 401);
    
    try {
        const token = authHeader.replace('Bearer ', '');
        const payload = JSON.parse(atob(token.split('.')[1]));
        const commentId = c.req.param('commentId');
        
        await c.env.DB.prepare(`
            UPDATE news_comments 
            SET is_deleted = 1, deleted_at = datetime("now", "+8 hours") 
            WHERE id = ? AND user_id = ? AND is_deleted = 0
        `).bind(commentId, payload.sub).run();
        
        return c.json({ success: true });
    } catch {
        return c.json({ error: 'Invalid token' }, 401);
    }
});

export default comments;

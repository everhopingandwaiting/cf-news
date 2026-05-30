import { Bindings } from '../types';

interface WsComment {
    id: number;
    news_id: number;
    user_id: number;
    username: string;
    content: string;
    created_at: string;
}

// Durable Object for real-time comments per news item
// Each DO instance is keyed by newsId — all users viewing the same article share one room
export class CommentsRoom {
    private connections: Map<WebSocket, { userId: number; username: string }> = new Map();
    private env: Bindings;

    constructor(ctx: DurableObjectState, env: Bindings) {
        this.env = env;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const newsId = parseInt(url.searchParams.get('newsId') || '0');
        const userId = parseInt(url.searchParams.get('uid') || '0');
        const username = url.searchParams.get('username') || '';

        if (!newsId || !userId) return new Response('Unauthorized', { status: 401 });

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        server.accept();
        this.connections.set(server, { userId, username });

        // Send initial comments list on connection
        try {
            const comments = await this.loadComments(newsId);
            server.send(JSON.stringify({ type: 'comments', comments }));
        } catch (e) {
            console.error('CommentsRoom: failed to load initial comments', e);
            server.send(JSON.stringify({ type: 'comments', comments: [] }));
        }

        server.addEventListener('message', async (event) => {
            try {
                const msg = JSON.parse(event.data as string);
                if (msg.type === 'create' && msg.content?.trim()) {
                    const comment = await this.createComment(newsId, userId, username, msg.content.trim());
                    if (comment) {
                        this.broadcast({ type: 'new_comment', comment });
                    }
                } else if (msg.type === 'delete' && msg.commentId) {
                    const ok = await this.deleteComment(msg.commentId, userId);
                    if (ok) {
                        this.broadcast({ type: 'delete', commentId: msg.commentId });
                    }
                }
            } catch (e) {
                console.error('CommentsRoom: invalid message', e);
            }
        });

        server.addEventListener('close', () => {
            this.connections.delete(server);
        });

        return new Response(null, { status: 101, webSocket: client });
    }

    private async loadComments(newsId: number): Promise<WsComment[]> {
        const result = await this.env.DB.prepare(`
            SELECT nc.id, nc.news_id, nc.user_id, u.username, nc.content, nc.created_at
            FROM news_comments nc
            JOIN users u ON nc.user_id = u.id
            WHERE nc.news_id = ? AND nc.is_deleted = 0
            ORDER BY nc.created_at ASC
        `).bind(newsId).all<WsComment>();
        return result.results || [];
    }

    private async createComment(newsId: number, userId: number, username: string, content: string): Promise<WsComment | null> {
        const result = await this.env.DB.prepare(`
            INSERT INTO news_comments (news_id, user_id, content, created_at)
            VALUES (?, ?, ?, datetime('now', '+8 hours'))
        `).bind(newsId, userId, content).run();

        const id = result.meta.last_row_id;
        if (!id) return null;

        // Fetch back the full comment with joined username
        const comment = await this.env.DB.prepare(`
            SELECT nc.id, nc.news_id, nc.user_id, u.username, nc.content, nc.created_at
            FROM news_comments nc
            JOIN users u ON nc.user_id = u.id
            WHERE nc.id = ?
        `).bind(id).first<WsComment>();

        return comment || null;
    }

    private async deleteComment(commentId: number, userId: number): Promise<boolean> {
        const result = await this.env.DB.prepare(`
            UPDATE news_comments
            SET is_deleted = 1, deleted_at = datetime("now", "+8 hours")
            WHERE id = ? AND user_id = ? AND is_deleted = 0
        `).bind(commentId, userId).run();
        return result.success;
    }

    private broadcast(msg: object) {
        const raw = JSON.stringify(msg);
        for (const [ws] of this.connections) {
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(raw); } catch {}
            }
        }
    }
}

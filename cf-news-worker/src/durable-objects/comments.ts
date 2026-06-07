import { Bindings } from '../types';
import { eq, sql, and } from 'drizzle-orm';
import { getDb } from '../db';
import { newsComments, users } from '../db/schema';

interface WsComment {
    id: number;
    news_id: number;
    user_id: number;
    username: string;
    content: string;
    created_at: string;
}

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
        const db = getDb(this.env);
        return db.all<WsComment>(sql`
            SELECT nc.id, nc.news_id, nc.user_id, u.username, nc.content, nc.created_at
            FROM news_comments nc
            JOIN users u ON nc.user_id = u.id
            WHERE nc.news_id = ${newsId} AND nc.is_deleted = 0
            ORDER BY nc.created_at ASC
        `);
    }

    private async createComment(newsId: number, userId: number, username: string, content: string): Promise<WsComment | null> {
        const db = getDb(this.env);
        const result = await db.run(sql`
            INSERT INTO news_comments (news_id, user_id, content, created_at)
            VALUES (${newsId}, ${userId}, ${content}, datetime('now', '+8 hours'))
        `);

        const id = result.meta.last_row_id;
        if (!id) return null;

        const comments = await db.all<WsComment>(sql`
            SELECT nc.id, nc.news_id, nc.user_id, u.username, nc.content, nc.created_at
            FROM news_comments nc
            JOIN users u ON nc.user_id = u.id
            WHERE nc.id = ${id}
        `);
        return comments[0] || null;
    }

    private async deleteComment(commentId: number, userId: number): Promise<boolean> {
        const db = getDb(this.env);
        const result = await db.run(sql`
            UPDATE news_comments
            SET is_deleted = 1, deleted_at = datetime("now", "+8 hours")
            WHERE id = ${commentId} AND user_id = ${userId} AND is_deleted = 0
        `);
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

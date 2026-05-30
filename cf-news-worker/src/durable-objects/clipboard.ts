interface ClipboardMessage {
    type: 'text' | 'image' | 'sync_clipboard' | 'heartbeat';
    content?: string;
    data?: string;
    mime?: string;
    size?: number;
    sender?: string;
}

// Durable Object for real-time clipboard sharing between same-user sessions
export class ClipboardRoom {
    private connections: Map<WebSocket, number> = new Map();
    private storage: DurableObjectStorage;

    constructor(state: DurableObjectState, env: any) {
        this.storage = state.storage;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const userId = parseInt(url.searchParams.get('uid') || '0');
        if (!userId) return new Response('Unauthorized', { status: 401 });

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        server.accept();
        this.connections.set(server, userId);
        console.log(`Clipboard: user ${userId} connected (${this.connectionCount(userId)} active)`);

        // Deliver pending sync_clipboard messages to newly connecting clients
        this.deliverPendingSync(server, userId);

        server.addEventListener('message', (event) => {
            try {
                const msg: ClipboardMessage = JSON.parse(event.data as string);
                if (msg.type === 'sync_clipboard') {
                    this.storage.put(`sync:${userId}`, event.data as string).catch(() => {});
                }
                if (msg.type && msg.type !== 'heartbeat') {
                    this.broadcast(userId, server, msg);
                }
            } catch (e) {
                console.error('Clipboard: invalid message', e);
            }
        });

        server.addEventListener('close', () => {
            this.connections.delete(server);
            const remaining = this.connectionCount(userId);
            console.log(`Clipboard: user ${userId} disconnected (${remaining} remaining)`);
            // If no more connections for this user, clear pending sync
            if (remaining === 0) {
                this.storage.delete(`sync:${userId}`).catch(() => {});
            }
        });

        return new Response(null, { status: 101, webSocket: client });
    }

    private async deliverPendingSync(ws: WebSocket, userId: number) {
        try {
            const raw = await this.storage.get<string>(`sync:${userId}`);
            if (raw && ws.readyState === WebSocket.OPEN) {
                ws.send(raw);
                console.log(`Clipboard: delivered pending sync to user ${userId}`);
            }
        } catch (e) {
            console.error('Clipboard: deliverPendingSync error', e);
        }
    }

    private broadcast(senderUserId: number, senderWs: WebSocket, msg: ClipboardMessage) {
        const raw = JSON.stringify(msg);
        for (const [ws, uid] of this.connections) {
            if (uid === senderUserId && ws !== senderWs && ws.readyState === WebSocket.OPEN) {
                try { ws.send(raw); } catch {}
            }
        }
    }

    private connectionCount(userId: number): number {
        let count = 0;
        for (const [, uid] of this.connections) {
            if (uid === userId) count++;
        }
        return count;
    }
}

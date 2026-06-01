interface ClipboardMessage {
    type: 'text' | 'image' | 'sync_clipboard' | 'heartbeat'
        | 'file_offer' | 'file_accept' | 'file_reject' | 'file_complete' | 'file_cancel';
    content?: string;
    data?: string;
    mime?: string;
    size?: number;
    sender?: string;
    // file transfer fields
    transferId?: string;
    fileName?: string;
    fileSize?: number;
    totalChunks?: number;
}

interface ConnInfo {
    userId: number;
    deviceId: string;
}

// Durable Object for real-time clipboard sharing between same-user sessions
export class ClipboardRoom {
    private connections: Map<WebSocket, ConnInfo> = new Map();
    private storage: DurableObjectStorage;

    constructor(state: DurableObjectState, env: any) {
        this.storage = state.storage;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const userId = parseInt(url.searchParams.get('uid') || '0');
        const deviceId = url.searchParams.get('device_id') || '';
        if (!userId) return new Response('Unauthorized', { status: 401 });

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        server.binaryType = 'arraybuffer';
        server.accept();
        this.connections.set(server, { userId, deviceId });

        this.deliverPendingSync(server, userId);

        server.addEventListener('message', (event) => {
            const info = this.connections.get(server);
            if (!info) return;
            // Binary: relay file chunks as-is
            if (typeof event.data === 'object') {
                this.broadcastBinary(server, info, event.data as ArrayBuffer);
                return;
            }
            try {
                const msg: ClipboardMessage = JSON.parse(event.data as string);
                if (msg.type === 'heartbeat') {
                    if (server.readyState === WebSocket.OPEN) {
                        try { server.send('{"type":"heartbeat_ack"}'); } catch {}
                    }
                    return;
                }
                if (msg.type === 'sync_clipboard') {
                    this.storage.put(`sync:${userId}`, event.data as string).catch(() => {});
                    this.storage.setAlarm(Date.now() + 60 * 60 * 1000).catch(() => {});
                }
                if (msg.type) {
                    this.broadcast(server, info, msg);
                }
            } catch (e) {
                console.error('Clipboard: invalid message', e);
            }
        });

        server.addEventListener('close', () => {
            this.connections.delete(server);
            const remaining = this.connectionCount(userId);
            console.log(`Clipboard: user ${userId} device ${deviceId} disconnected (${remaining} remaining)`);
            if (remaining === 0) {
                this.storage.setAlarm(Date.now() + 60 * 60 * 1000).catch(() => {});
            }
        });

        server.addEventListener('error', (e) => {
            console.error('Clipboard: connection error', e);
        });

        return new Response(null, { status: 101, webSocket: client });
    }

    async alarm() {
        try {
            const keys = await this.storage.list({ prefix: 'sync:' });
            for (const key of keys.keys()) {
                await this.storage.delete(key);
            }
        } catch (e) {
            console.error('Clipboard: alarm cleanup error', e);
        }
    }

    private async deliverPendingSync(ws: WebSocket, userId: number) {
        try {
            const raw = await this.storage.get<string>(`sync:${userId}`);
            if (raw && ws.readyState === WebSocket.OPEN) {
                ws.send(raw);
            }
        } catch (e) {
            console.error('Clipboard: deliverPendingSync error', e);
        }
    }

    private broadcast(senderWs: WebSocket, senderInfo: ConnInfo, msg: ClipboardMessage) {
        const raw = JSON.stringify(msg);
        for (const [ws, info] of this.connections) {
            if (info.userId === senderInfo.userId && ws !== senderWs && info.deviceId !== senderInfo.deviceId && ws.readyState === WebSocket.OPEN) {
                try { ws.send(raw); } catch {}
            }
        }
    }

    private broadcastBinary(senderWs: WebSocket, senderInfo: ConnInfo, buf: ArrayBuffer) {
        for (const [ws, info] of this.connections) {
            if (info.userId === senderInfo.userId && ws !== senderWs && info.deviceId !== senderInfo.deviceId && ws.readyState === WebSocket.OPEN) {
                try { ws.send(buf); } catch {}
            }
        }
    }

    private connectionCount(userId: number): number {
        let count = 0;
        for (const [, info] of this.connections) {
            if (info.userId === userId) count++;
        }
        return count;
    }
}

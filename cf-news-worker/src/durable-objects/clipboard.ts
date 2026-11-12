interface ClipboardMessage {
    type: 'text' | 'image' | 'sync_clipboard' | 'heartbeat'
        | 'file_offer' | 'file_accept' | 'file_reject' | 'file_complete' | 'file_cancel'
        | 'presence' | 'presence_update';
    content?: string;
    data?: string;
    mime?: string;
    size?: number;
    sender?: string;
    deviceId?: string;
    transport?: 'wss' | 'http';
    // file transfer fields
    transferId?: string;
    fileName?: string;
    fileSize?: number;
    totalChunks?: number;
    acceptedBy?: string;
}

interface ConnInfo {
    userId: number;
    deviceId: string;
    deviceName: string;
    connectedAt: number;
}

const MAX_TEXT_LENGTH = 200_000;
const MAX_IMAGE_BASE64_LENGTH = 7_000_000;
const MAX_BINARY_FRAME_BYTES = 1_100_000;
const MAX_FILE_NAME_LENGTH = 180;
const MAX_HTTP_FILE_SIZE = 100 * 1024 * 1024;
const MAX_WSS_FILE_SIZE = 4 * 1024 * 1024 * 1024;
const MAX_TRANSFER_CHUNKS = 4096;
// A transfer nobody finishes (sender/receiver vanished) is forgotten after this idle window.
const MAX_TRANSFER_IDLE_MS = 5 * 60_000;
const MAX_CHUNK_HEADER_BYTES = 4096;
const ALLOWED_TYPES = new Set([
    'text', 'image', 'sync_clipboard', 'heartbeat',
    'file_offer', 'file_accept', 'file_reject', 'file_complete', 'file_cancel',
    'presence',
]);

// Durable Object for real-time clipboard sharing between same-user sessions
export class ClipboardRoom {
    private connections: Map<WebSocket, ConnInfo> = new Map();
    private acceptedTransfers: Map<string, { deviceId: string; touchedAt: number }> = new Map();
    private transferSenders: Map<string, { deviceId: string; touchedAt: number }> = new Map();
    private storage: DurableObjectStorage;

    constructor(state: DurableObjectState, env: any) {
        this.storage = state.storage;
    }

    async fetch(request: Request): Promise<Response> {
        const url = new URL(request.url);
        const userId = parseInt(url.searchParams.get('uid') || '0');
        const deviceId = url.searchParams.get('device_id') || '';
        const deviceName = (url.searchParams.get('device_name') || 'Unknown device').slice(0, 80);
        if (!userId) return new Response('Unauthorized', { status: 401 });

        this.sweepTransfers();

        const pair = new WebSocketPair();
        const [client, server] = Object.values(pair);

        server.binaryType = 'arraybuffer';
        server.accept();
        this.connections.set(server, { userId, deviceId, deviceName, connectedAt: Date.now() });

        this.deliverPendingSync(server, userId);
        this.broadcastPresence(userId);

        server.addEventListener('message', (event) => {
            const info = this.connections.get(server);
            if (!info) return;
            // Binary: relay file chunks as-is
            if (typeof event.data === 'object') {
                const frame = event.data as ArrayBuffer;
                if (frame.byteLength > MAX_BINARY_FRAME_BYTES) {
                    try { server.send(JSON.stringify({ type: 'file_cancel' })); } catch {}
                    return;
                }
                // Only the device that offered a transfer may stream its chunks, and only
                // the device that accepted it receives them — no fan-out to idle devices.
                const transferId = this.chunkTransferId(frame);
                const sender = transferId ? this.transferSenders.get(transferId) : null;
                const receiver = transferId ? this.acceptedTransfers.get(transferId) : null;
                if (!transferId || !sender || !receiver || sender.deviceId !== info.deviceId) {
                    return;
                }
                sender.touchedAt = Date.now();
                receiver.touchedAt = Date.now();
                this.sendBinaryToDevice(info.userId, receiver.deviceId, frame);
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
                if (!this.isValidMessage(msg)) {
                    try { server.send(JSON.stringify({ type: 'file_cancel', transferId: msg.transferId })); } catch {}
                    return;
                }
                if (msg.type === 'presence') {
                    this.broadcastPresence(userId);
                    return;
                }
                if (msg.type === 'sync_clipboard') {
                    this.storage.put(`sync:${userId}`, event.data as string).catch(() => {});
                    this.storage.setAlarm(Date.now() + 60 * 60 * 1000).catch(() => {});
                }
                if (msg.type === 'file_offer' && msg.transferId) {
                    this.transferSenders.set(msg.transferId, { deviceId: info.deviceId, touchedAt: Date.now() });
                }
                if (msg.type === 'file_accept' && msg.transferId) {
                    const accepted = this.acceptedTransfers.get(msg.transferId);
                    if (accepted && accepted.deviceId !== info.deviceId) {
                        try { server.send(JSON.stringify({ type: 'file_reject', transferId: msg.transferId })); } catch {}
                        return;
                    }
                    this.acceptedTransfers.set(msg.transferId, { deviceId: info.deviceId, touchedAt: Date.now() });
                    const senderDeviceId = this.transferSenders.get(msg.transferId)?.deviceId;
                    if (senderDeviceId) {
                        this.sendToDevice(info.userId, senderDeviceId, { ...msg, acceptedBy: info.deviceId });
                        this.broadcastCancelForOtherDevices(info, senderDeviceId, msg.transferId);
                    } else {
                        this.broadcast(server, info, { ...msg, acceptedBy: info.deviceId });
                    }
                    return;
                }
                if ((msg.type === 'file_cancel' || msg.type === 'file_complete') && msg.transferId) {
                    this.acceptedTransfers.delete(msg.transferId);
                    this.transferSenders.delete(msg.transferId);
                }
                if (msg.type === 'file_reject' && msg.transferId) {
                    const senderDeviceId = this.transferSenders.get(msg.transferId)?.deviceId;
                    if (senderDeviceId) {
                        if (this.receiverCount(info.userId, senderDeviceId) <= 1) {
                            this.sendToDevice(info.userId, senderDeviceId, msg);
                        }
                        return;
                    }
                    return;
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
            this.sweepTransfers();
            const remaining = this.connectionCount(userId);
            console.log(`Clipboard: user ${userId} device ${deviceId} disconnected (${remaining} remaining)`);
            this.broadcastPresence(userId);
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

    private broadcastPresence(userId: number) {
        const devices = Array.from(this.connections.values())
            .filter(info => info.userId === userId)
            .map(info => ({
                deviceId: info.deviceId,
                deviceName: info.deviceName,
                connectedAt: info.connectedAt,
            }));
        const raw = JSON.stringify({ type: 'presence_update', devices });
        for (const [ws, info] of this.connections) {
            if (info.userId === userId && ws.readyState === WebSocket.OPEN) {
                try { ws.send(raw); } catch {}
            }
        }
    }

    private sendToDevice(userId: number, deviceId: string, msg: ClipboardMessage) {
        const raw = JSON.stringify(msg);
        for (const [ws, info] of this.connections) {
            if (info.userId === userId && info.deviceId === deviceId && ws.readyState === WebSocket.OPEN) {
                try { ws.send(raw); } catch {}
            }
        }
    }

    private broadcastCancelForOtherDevices(receiverInfo: ConnInfo, senderDeviceId: string, transferId: string) {
        const raw = JSON.stringify({ type: 'file_cancel', transferId });
        for (const [ws, info] of this.connections) {
            if (
                info.userId === receiverInfo.userId
                && info.deviceId !== receiverInfo.deviceId
                && info.deviceId !== senderDeviceId
                && ws.readyState === WebSocket.OPEN
            ) {
                try { ws.send(raw); } catch {}
            }
        }
    }

    private sendBinaryToDevice(userId: number, deviceId: string, buf: ArrayBuffer) {
        for (const [ws, info] of this.connections) {
            if (info.userId === userId && info.deviceId === deviceId && ws.readyState === WebSocket.OPEN) {
                try { ws.send(buf); } catch {}
            }
        }
    }

    /** transferId from a binary chunk frame: u32 BE header length + JSON header {t:'fc',i}. */
    private chunkTransferId(frame: ArrayBuffer): string | null {
        try {
            if (frame.byteLength < 8) return null;
            const headerLen = new DataView(frame).getUint32(0, false);
            if (headerLen === 0 || headerLen > MAX_CHUNK_HEADER_BYTES || 4 + headerLen > frame.byteLength) return null;
            const header = JSON.parse(new TextDecoder().decode(new Uint8Array(frame, 4, headerLen)));
            return header?.t === 'fc' && typeof header.i === 'string' ? header.i : null;
        } catch {
            return null;
        }
    }

    /** Drop transfers whose parties went away mid-transfer (lazy: on connect and disconnect). */
    private sweepTransfers() {
        const cutoff = Date.now() - MAX_TRANSFER_IDLE_MS;
        for (const [id, t] of this.transferSenders) if (t.touchedAt < cutoff) this.transferSenders.delete(id);
        for (const [id, t] of this.acceptedTransfers) if (t.touchedAt < cutoff) this.acceptedTransfers.delete(id);
    }

    private connectionCount(userId: number): number {
        let count = 0;
        for (const [, info] of this.connections) {
            if (info.userId === userId) count++;
        }
        return count;
    }

    private receiverCount(userId: number, senderDeviceId: string): number {
        let count = 0;
        for (const [, info] of this.connections) {
            if (info.userId === userId && info.deviceId !== senderDeviceId) count++;
        }
        return count;
    }

    private isValidMessage(msg: ClipboardMessage): boolean {
        if (!msg?.type || !ALLOWED_TYPES.has(msg.type)) return false;
        if (msg.content && msg.content.length > MAX_TEXT_LENGTH) return false;
        if (msg.data && msg.data.length > MAX_IMAGE_BASE64_LENGTH) return false;
        if (msg.fileName && msg.fileName.length > MAX_FILE_NAME_LENGTH) return false;
        if (msg.fileSize !== undefined) {
            const maxSize = msg.transport === 'http' ? MAX_HTTP_FILE_SIZE : MAX_WSS_FILE_SIZE;
            if (msg.fileSize < 0 || msg.fileSize > maxSize) return false;
        }
        if (msg.totalChunks !== undefined && (msg.totalChunks < 0 || msg.totalChunks > MAX_TRANSFER_CHUNKS)) return false;
        if (msg.transport && msg.transport !== 'wss' && msg.transport !== 'http') return false;
        return true;
    }
}

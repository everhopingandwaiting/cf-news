import { useEffect, useRef, useState, useCallback, useMemo } from 'react';

const MAX_CACHED_IMAGES = 10;
const CHUNK_SIZE = 1024 * 1024; // 1MB per WS chunk

export function jwtUserId(token: string): string {
    try {
        return JSON.parse(atob(token.split('.')[1])).sub || '';
    } catch { return ''; }
}

function lsUserKeys(token: string) {
    const uid = jwtUserId(token);
    const suffix = uid ? `_${uid}` : '';
    return {
        text: `cb_text${suffix}`,
        images: `cb_images${suffix}`,
        deviceName: `cb_device_name${suffix}`,
        deviceId: `cb_device_id${suffix}`,
        history: `cb_history${suffix}`,
    };
}

const LS_DEVICE_KEY = 'cb_device_name';
const LS_DEVICE_ID_KEY = 'cb_device_id';

function getDeviceId(): string {
    try {
        const stored = localStorage.getItem(LS_DEVICE_ID_KEY);
        if (stored) return stored;
    } catch {}
    const id = crypto.randomUUID();
    try { localStorage.setItem(LS_DEVICE_ID_KEY, id); } catch {}
    return id;
}

const BACKOFF_BASE = 1000;
const BACKOFF_MAX = 30000;
const DEBOUNCE_MS = 500;
const HEARTBEAT_MS = 30000;
const HEARTBEAT_TIMEOUT_MS = 90000;
const HEARTBEAT_CHECK_MS = 10000;
const OFFER_TIMEOUT_MS = 60000;

interface ClipboardMsg {
    type: 'text' | 'image' | 'sync_clipboard' | 'heartbeat' | 'heartbeat_ack'
        | 'file_offer' | 'file_accept' | 'file_reject' | 'file_complete' | 'file_cancel';
    content?: string;
    data?: string;
    mime?: string;
    sender?: string;
    transferId?: string;
    fileName?: string;
    fileSize?: number;
    totalChunks?: number;
}

interface IncomingFileOffer {
    transferId: string;
    fileName: string;
    fileSize: number;
    mime: string;
    totalChunks: number;
    receivedAt: number;
}

interface FileTransfer {
    transferId: string;
    fileName: string;
    fileSize: number;
    mime: string;
    totalChunks: number;
    receivedChunks: number;
    chunks: ArrayBuffer[];
    direction: 'send' | 'receive';
    status: 'offering' | 'accepted' | 'transferring' | 'complete' | 'cancelled' | 'rejected';
    progress: number;
    startedAt: number;
    completedAt?: number;
}

function loadLS<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveLS(key: string, val: any) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

const DB_NAME = 'cf_news';
const DB_VERSION = 1;
const STORE_NAME = 'clipboard_images';

function dbOpen(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(STORE_NAME))
                req.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function dbGet(key: string): Promise<{ data: string; mime: string; sender?: string }[] | null> {
    return dbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = () => { resolve(req.result?.value ?? null); db.close(); };
        req.onerror = () => { reject(req.error); db.close(); };
    }));
}

function dbSet(key: string, value: { data: string; mime: string; sender?: string }[]) {
    dbOpen().then(db => new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put({ id: key, value });
        tx.oncomplete = () => { resolve(); db.close(); };
        tx.onerror = () => { reject(tx.error); db.close(); };
    }));
}

function getDeviceName(): string {
    try {
        const stored = localStorage.getItem(LS_DEVICE_KEY);
        if (stored) return stored;
    } catch {}
    const ua = navigator.userAgent;
    let os = 'Unknown';
    if (/Windows/.test(ua)) os = 'Windows';
    else if (/Mac OS/.test(ua)) os = 'macOS';
    else if (/Linux/.test(ua)) os = 'Linux';
    else if (/Android/.test(ua)) os = 'Android';
    else if (/iPhone|iPad/.test(ua)) os = 'iOS';
    let browser = 'Browser';
    if (/Chrome/.test(ua) && !/Edg/.test(ua)) browser = 'Chrome';
    else if (/Safari/.test(ua) && !/Chrome/.test(ua)) browser = 'Safari';
    else if (/Firefox/.test(ua)) browser = 'Firefox';
    else if (/Edg/.test(ua)) browser = 'Edge';
    const name = `${browser} · ${os}`;
    try { localStorage.setItem(LS_DEVICE_KEY, name); } catch {}
    return name;
}

export function useClipboardWS(token: string, panelOpen: boolean) {
    const ukeys = useMemo(() => lsUserKeys(token), [token]);
    const [text, setText] = useState(() => loadLS(ukeys.text, ''));
    const [images, setImages] = useState<{ data: string; mime: string; sender?: string }[]>([]);
    const [connectionState, setConnectionState] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
    const [hasNewData, setHasNewData] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);
    const [incomingOffers, setIncomingOffers] = useState<IncomingFileOffer[]>([]);
    const [fileTransfers, setFileTransfers] = useState<FileTransfer[]>([]);
    const pendingResolve = useRef<Map<string, (success: boolean) => void>>(new Map());

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const heartbeatCheckRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const lastPongRef = useRef<number>(Date.now());
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const panelOpenRef = useRef(panelOpen);
    panelOpenRef.current = panelOpen;
    const backoffRef = useRef(0);
    const queueRef = useRef<ClipboardMsg[]>([]);
    const deviceNameRef = useRef(getDeviceName());
    const deviceIdRef = useRef(getDeviceId());
    const disposedRef = useRef(false);
    const [deviceName] = useState(deviceNameRef.current);

    const clearHeartbeat = useCallback(() => {
        if (heartbeatRef.current) { clearInterval(heartbeatRef.current); heartbeatRef.current = null; }
    }, []);
    const clearHeartbeatCheck = useCallback(() => {
        if (heartbeatCheckRef.current) { clearInterval(heartbeatCheckRef.current); heartbeatCheckRef.current = null; }
    }, []);
    const clearReconnect = useCallback(() => {
        if (reconnectRef.current) { clearTimeout(reconnectRef.current); reconnectRef.current = null; }
    }, []);
    const clearDebounce = useCallback(() => {
        if (debounceRef.current) { clearTimeout(debounceRef.current); debounceRef.current = null; }
    }, []);
    const enqueueMsg = useCallback((msg: ClipboardMsg) => {
        queueRef.current.push(msg);
        setPendingCount(queueRef.current.length);
    }, []);
    const flushQueue = useCallback(() => {
        const q = queueRef.current;
        if (q.length === 0) return;
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
            queueRef.current = [];
            setPendingCount(0);
            for (const msg of q) ws.send(JSON.stringify(msg));
        }
    }, []);
    const safeSend = useCallback((msg: ClipboardMsg) => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
        else enqueueMsg(msg);
    }, [enqueueMsg]);

    // Download helper: triggers browser file download from chunks
    const triggerDownloadRef = useRef<((transferId: string, fileName: string, chunks: ArrayBuffer[], mime: string) => void) | null>(null);
    triggerDownloadRef.current = (transferId, fileName, chunks, mime) => {
        const blob = new Blob(chunks, { type: mime });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        setTimeout(() => { a.click(); setTimeout(() => URL.revokeObjectURL(url), 10000); }, 0);
        setFileTransfers(p => p.map(t =>
            t.transferId === transferId
                ? { ...t, status: 'complete', progress: 100, completedAt: Date.now(), chunks: [] }
                : t
        ));
    };

    const connect = useCallback(() => {
        if (!token) return;
        clearReconnect();
        clearHeartbeat();
        setConnectionState('connecting');
        const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/clipboard/ws?token=${encodeURIComponent(token)}&device_id=${encodeURIComponent(deviceIdRef.current)}`;
        const ws = new WebSocket(wsUrl);
        ws.binaryType = 'arraybuffer';

        ws.onopen = () => {
            setConnectionState('connected');
            backoffRef.current = 0;
            lastPongRef.current = Date.now();
            flushQueue();
            heartbeatRef.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) ws.send('{"type":"heartbeat"}');
            }, HEARTBEAT_MS);
            heartbeatCheckRef.current = setInterval(() => {
                if (Date.now() - lastPongRef.current > HEARTBEAT_TIMEOUT_MS) {
                    ws.close(4000, 'heartbeat timeout');
                }
            }, HEARTBEAT_CHECK_MS);
        };

        ws.onmessage = (event) => {
            lastPongRef.current = Date.now();
            // Binary: file chunk
            if (event.data instanceof ArrayBuffer) {
                const buf = event.data as ArrayBuffer;
                if (buf.byteLength < 4) return;
                const view = new DataView(buf);
                const headerLen = view.getUint32(0, false);
                const headerBytes = new TextDecoder().decode(new Uint8Array(buf, 4, headerLen));
                const header = JSON.parse(headerBytes);
                if (header.t === 'fc') {
                    const chunkData = buf.slice(4 + headerLen);
                    setFileTransfers(prev => {
                        const ft = prev.find(t => t.transferId === header.i);
                        if (!ft || ft.direction !== 'receive' || ft.status !== 'transferring') return prev;
                        const next = { ...ft, chunks: [...ft.chunks, chunkData], receivedChunks: ft.receivedChunks + 1 };
                        next.progress = ft.totalChunks > 0 ? Math.round((next.receivedChunks / ft.totalChunks) * 100) : 0;
                        if (next.receivedChunks >= ft.totalChunks) {
                            // Trigger download outside render cycle via ref
                            setTimeout(() => triggerDownloadRef.current?.(header.i, ft.fileName, next.chunks, ft.mime), 0);
                            return prev.map(t => t.transferId === header.i ? { ...next, status: 'complete', progress: 100, completedAt: Date.now() } : t);
                        }
                        return prev.map(t => t.transferId === header.i ? next : t);
                    });
                }
                return;
            }
            // Text: control messages
            try {
                const msg: ClipboardMsg = JSON.parse(event.data);
                if (msg.type === 'heartbeat' || msg.type === 'heartbeat_ack') return;
                if (msg.type === 'text' && msg.content !== undefined) {
                    clearDebounce();
                    setText(msg.content);
                    if (!panelOpenRef.current) setHasNewData(true);
                } else if (msg.type === 'image' && msg.data) {
                    setImages(prev => {
                        const next = [...prev, { data: msg.data!, mime: msg.mime || 'image/png', sender: msg.sender }].slice(-MAX_CACHED_IMAGES);
                        dbSet(ukeys.images, next);
                        return next;
                    });
                    if (!panelOpenRef.current) setHasNewData(true);
                } else if (msg.type === 'sync_clipboard' && msg.content) {
                    navigator.clipboard.writeText(msg.content).catch(() => {});
                } else if (msg.type === 'file_offer' && msg.transferId) {
                    setIncomingOffers(prev => [...prev, {
                        transferId: msg.transferId!, fileName: msg.fileName || 'unknown',
                        fileSize: msg.fileSize || 0, mime: msg.mime || 'application/octet-stream',
                        totalChunks: msg.totalChunks || 0, receivedAt: Date.now(),
                    }]);
                    setFileTransfers(prev => {
                        if (prev.find(t => t.transferId === msg.transferId)) return prev;
                        return [...prev, {
                            transferId: msg.transferId!, fileName: msg.fileName || 'unknown',
                            fileSize: msg.fileSize || 0, mime: msg.mime || 'application/octet-stream',
                            totalChunks: msg.totalChunks || 0, receivedChunks: 0, chunks: [],
                            direction: 'receive', status: 'offering', progress: 0, startedAt: Date.now(),
                        }];
                    });
                    if (!panelOpenRef.current) setHasNewData(true);
                } else if (msg.type === 'file_accept' && msg.transferId) {
                    setFileTransfers(prev => prev.map(t =>
                        t.transferId === msg.transferId ? { ...t, status: 'accepted' as const } : t
                    ));
                    const r = pendingResolve.current.get(msg.transferId);
                    if (r) { pendingResolve.current.delete(msg.transferId); r(true); }
                } else if (msg.type === 'file_reject' && msg.transferId) {
                    setFileTransfers(prev => prev.map(t =>
                        t.transferId === msg.transferId ? { ...t, status: 'rejected' as const } : t
                    ));
                    const r = pendingResolve.current.get(msg.transferId);
                    if (r) { pendingResolve.current.delete(msg.transferId); r(false); }
                } else if (msg.type === 'file_cancel' && msg.transferId) {
                    setFileTransfers(prev => prev.map(t =>
                        t.transferId === msg.transferId ? { ...t, status: 'cancelled' as const } : t
                    ));
                    setIncomingOffers(prev => prev.filter(o => o.transferId !== msg.transferId));
                }
            } catch {}
        };

        ws.onclose = () => {
            clearHeartbeat(); clearHeartbeatCheck();
            wsRef.current = null;
            if (disposedRef.current) {
                setConnectionState('disconnected');
                return;
            }
            setConnectionState('connecting');
            const delay = Math.min(BACKOFF_BASE * Math.pow(2, backoffRef.current), BACKOFF_MAX);
            backoffRef.current++;
            reconnectRef.current = setTimeout(() => connect(), delay);
        };
        ws.onerror = () => ws.close();
        wsRef.current = ws;
    }, [token, clearReconnect, clearHeartbeat, clearHeartbeatCheck, clearDebounce, flushQueue, safeSend]);

    useEffect(() => {
        disposedRef.current = false;
        if (!token) return;
        connect();
        return () => {
            disposedRef.current = true;
            clearReconnect(); clearHeartbeat(); clearHeartbeatCheck(); clearDebounce();
            wsRef.current?.close(); wsRef.current = null;
            backoffRef.current = 0;
            setConnectionState('disconnected');
        };
    }, [token, connect, clearReconnect, clearHeartbeat, clearHeartbeatCheck, clearDebounce]);

    useEffect(() => { saveLS(ukeys.text, text); }, [text, ukeys.text]);
    useEffect(() => {
        dbGet(ukeys.images).then(stored => {
            if (stored && stored.length) {
                setImages(stored);
                return;
            }
            const ls = loadLS<{ data: string; mime: string; sender?: string }[]>(ukeys.images, []);
            if (ls.length) {
                setImages(ls);
                dbSet(ukeys.images, ls);
                try { localStorage.removeItem(ukeys.images); } catch {}
                return;
            }
            const count = loadLS<number>(ukeys.images + ':n', 0);
            if (count) {
                const migrated: { data: string; mime: string; sender?: string }[] = [];
                for (let i = 0; i < Math.min(count, MAX_CACHED_IMAGES); i++) {
                    const img = loadLS<{ data: string; mime: string; sender?: string } | null>(ukeys.images + ':' + i, null);
                    if (img) migrated.push(img);
                    try { localStorage.removeItem(ukeys.images + ':' + i); } catch {}
                }
                try { localStorage.removeItem(ukeys.images + ':n'); } catch {}
                if (migrated.length) {
                    setImages(migrated);
                    dbSet(ukeys.images, migrated);
                }
            }
        });
    }, [ukeys.images]);
    useEffect(() => { if (panelOpen) setHasNewData(false); }, [panelOpen]);
    useEffect(() => {
        if (incomingOffers.length === 0) return;
        const oldest = incomingOffers[0];
        const elapsed = Date.now() - oldest.receivedAt;
        if (elapsed >= OFFER_TIMEOUT_MS) {
            setIncomingOffers(prev => prev.filter(o => o.transferId !== oldest.transferId));
            safeSend({ type: 'file_reject', transferId: oldest.transferId });
            return;
        }
        const t = setTimeout(() => {
            setIncomingOffers(prev => prev.filter(o => o.transferId !== oldest.transferId));
            safeSend({ type: 'file_reject', transferId: oldest.transferId });
        }, OFFER_TIMEOUT_MS - elapsed);
        return () => clearTimeout(t);
    }, [incomingOffers, safeSend]);

    const clearNewDataFlag = useCallback(() => { setHasNewData(false); }, []);
    const sendText = useCallback((content: string) => {
        setText(content);
        clearDebounce();
        debounceRef.current = setTimeout(() => safeSend({ type: 'text', content, sender: deviceNameRef.current }), DEBOUNCE_MS);
    }, [clearDebounce, safeSend]);
    const sendImage = useCallback((data: string, mime: string) => {
        safeSend({ type: 'image', data, mime, sender: deviceNameRef.current });
        setImages(prev => {
            const next = [...prev, { data, mime, sender: deviceNameRef.current }].slice(-MAX_CACHED_IMAGES);
            dbSet(ukeys.images, next);
            return next;
        });
    }, [safeSend, ukeys.images]);
    const syncClipboard = useCallback((content: string) => {
        safeSend({ type: 'sync_clipboard', content, sender: deviceNameRef.current });
    }, [safeSend]);
    const clearImages = useCallback(() => {
        setImages([]);
        dbSet(ukeys.images, []);
    }, [ukeys.images]);

    // WS chunked file send
    const sendFile = useCallback(async (file: File) => {
        const ws = wsRef.current;
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        const transferId = crypto.randomUUID();
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

        setFileTransfers(prev => [...prev, {
            transferId, fileName: file.name, fileSize: file.size,
            mime: file.type || 'application/octet-stream', totalChunks,
            receivedChunks: 0, chunks: [],
            direction: 'send', status: 'offering', progress: 0, startedAt: Date.now(),
        }]);
        safeSend({ type: 'file_offer', transferId, fileName: file.name, fileSize: file.size, mime: file.type, totalChunks });

        const accepted = await new Promise<boolean>(resolve => {
            pendingResolve.current.set(transferId, resolve);
        });
        if (!accepted) return;

        setFileTransfers(prev => prev.map(t =>
            t.transferId === transferId ? { ...t, status: 'transferring' as const } : t
        ));

        try {
            for (let i = 0; i < totalChunks; i++) {
                // Backpressure: wait until buffer drains below 4MB
                while (wsRef.current && wsRef.current.bufferedAmount > CHUNK_SIZE * 4) {
                    await new Promise(r => setTimeout(r, 50));
                }
                const start = i * CHUNK_SIZE;
                const blob = file.slice(start, start + CHUNK_SIZE);
                const chunk = await blob.arrayBuffer();
                const header = JSON.stringify({ t: 'fc', i: transferId, c: i, tc: totalChunks });
                const headerBytes = new TextEncoder().encode(header);
                const frame = new ArrayBuffer(4 + headerBytes.byteLength + chunk.byteLength);
                const view = new DataView(frame);
                view.setUint32(0, headerBytes.byteLength, false);
                new Uint8Array(frame, 4, headerBytes.byteLength).set(headerBytes);
                new Uint8Array(frame, 4 + headerBytes.byteLength).set(new Uint8Array(chunk));
                wsRef.current?.send(frame);
                setFileTransfers(prev => prev.map(t =>
                    t.transferId === transferId ? { ...t, progress: Math.round(((i + 1) / totalChunks) * 100) } : t
                ));
            }
            // Wait for buffer to fully drain before marking complete
            while (wsRef.current && wsRef.current.bufferedAmount > 0) {
                await new Promise(r => setTimeout(r, 100));
            }
            safeSend({ type: 'file_complete', transferId });
            setFileTransfers(prev => prev.map(t =>
                t.transferId === transferId ? { ...t, status: 'complete' as const, progress: 100, completedAt: Date.now() } : t
            ));
        } catch {
            safeSend({ type: 'file_cancel', transferId });
            setFileTransfers(prev => prev.map(t =>
                t.transferId === transferId ? { ...t, status: 'cancelled' as const } : t
            ));
        }
    }, [safeSend]);

    const acceptFileOffer = useCallback((transferId: string) => {
        setIncomingOffers(prev => prev.filter(o => o.transferId !== transferId));
        setFileTransfers(prev => prev.map(t =>
            t.transferId === transferId ? { ...t, direction: 'receive' as const, status: 'transferring' as const } : t
        ));
        safeSend({ type: 'file_accept', transferId });
    }, [safeSend]);

    const rejectFileOffer = useCallback((transferId: string) => {
        setIncomingOffers(prev => prev.filter(o => o.transferId !== transferId));
        safeSend({ type: 'file_reject', transferId });
    }, [safeSend]);

    const cancelFileTransfer = useCallback((transferId: string) => {
        setFileTransfers(prev => prev.map(t =>
            t.transferId === transferId ? { ...t, status: 'cancelled' as const } : t
        ));
        const r = pendingResolve.current.get(transferId);
        if (r) { pendingResolve.current.delete(transferId); r(false); }
        safeSend({ type: 'file_cancel', transferId });
    }, [safeSend]);

    const connected = connectionState === 'connected';
    const connecting = connectionState === 'connecting';

    return {
        text, images, connected, connecting, hasNewData, pendingCount, deviceName,
        incomingOffers, fileTransfers, clearNewDataFlag,
        sendText, sendImage, syncClipboard, clearImages,
        sendFile, acceptFileOffer, rejectFileOffer, cancelFileTransfer,
    };
}

import { useEffect, useRef, useState, useCallback } from 'react';

const MAX_CACHED_IMAGES = 10;
const LS_TEXT_KEY = 'cb_text';
const LS_IMAGES_KEY = 'cb_images';
const LS_DEVICE_KEY = 'cb_device_name';

const BACKOFF_BASE = 1000;
const BACKOFF_MAX = 30000;
const DEBOUNCE_MS = 500;
const HEARTBEAT_MS = 30000;

interface ClipboardMsg {
    type: 'text' | 'image' | 'sync_clipboard';
    content?: string;
    data?: string;
    mime?: string;
    sender?: string;
}

function loadLS<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function saveLS(key: string, val: any) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
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
    const [text, setText] = useState(() => loadLS(LS_TEXT_KEY, ''));
    const [images, setImages] = useState<{ data: string; mime: string; sender?: string }[]>(() => loadLS(LS_IMAGES_KEY, []));
    const [connectionState, setConnectionState] = useState<'connected' | 'connecting' | 'disconnected'>('disconnected');
    const [hasNewData, setHasNewData] = useState(false);
    const [pendingCount, setPendingCount] = useState(0);

    const wsRef = useRef<WebSocket | null>(null);
    const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const heartbeatRef = useRef<ReturnType<typeof setInterval> | null>(null);
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const panelOpenRef = useRef(panelOpen);
    panelOpenRef.current = panelOpen;
    const backoffRef = useRef(0);
    const queueRef = useRef<ClipboardMsg[]>([]);
    const deviceNameRef = useRef(getDeviceName());
    const [deviceName] = useState(deviceNameRef.current);

    const clearHeartbeat = useCallback(() => {
        if (heartbeatRef.current) {
            clearInterval(heartbeatRef.current);
            heartbeatRef.current = null;
        }
    }, []);

    const clearReconnect = useCallback(() => {
        if (reconnectRef.current) {
            clearTimeout(reconnectRef.current);
            reconnectRef.current = null;
        }
    }, []);

    const clearDebounce = useCallback(() => {
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
            debounceRef.current = null;
        }
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
            for (const msg of q) {
                ws.send(JSON.stringify(msg));
            }
        }
    }, []);

    const safeSend = useCallback((msg: ClipboardMsg) => {
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify(msg));
        } else {
            enqueueMsg(msg);
        }
    }, [enqueueMsg]);

    const connect = useCallback(() => {
        if (!token) return;
        clearReconnect();
        clearHeartbeat();

        setConnectionState('connecting');
        const wsUrl = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/clipboard/ws?token=${encodeURIComponent(token)}`;
        const ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            setConnectionState('connected');
            backoffRef.current = 0;
            flushQueue();
            heartbeatRef.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send('{"type":"heartbeat"}'); // keepalive
                }
            }, HEARTBEAT_MS);
        };
        ws.onmessage = (event) => {
            try {
                const msg: ClipboardMsg = JSON.parse(event.data);
                if (msg.type === 'text' && msg.content !== undefined) {
                    clearDebounce(); // cancel pending send to avoid overwriting received text
                    setText(msg.content);
                    if (!panelOpenRef.current) setHasNewData(true);
                } else if (msg.type === 'image' && msg.data) {
                    setImages(prev => [...prev, { data: msg.data!, mime: msg.mime || 'image/png', sender: msg.sender }]);
                    if (!panelOpenRef.current) setHasNewData(true);
                } else if (msg.type === 'sync_clipboard' && msg.content) {
                    navigator.clipboard.writeText(msg.content).catch(() => {});
                }
            } catch {}
        };
        ws.onclose = () => {
            clearHeartbeat();
            wsRef.current = null;
            setConnectionState('connecting');
            const delay = Math.min(BACKOFF_BASE * Math.pow(2, backoffRef.current), BACKOFF_MAX);
            backoffRef.current++;
            reconnectRef.current = setTimeout(() => connect(), delay);
        };
        ws.onerror = () => ws.close();
        wsRef.current = ws;
    }, [token, clearReconnect, clearHeartbeat, clearDebounce, flushQueue]);

    useEffect(() => {
        if (!token) return;
        connect();
        return () => {
            clearReconnect();
            clearHeartbeat();
            clearDebounce();
            wsRef.current?.close();
            wsRef.current = null;
            backoffRef.current = 0;
            setConnectionState('disconnected');
        };
    }, [token, connect, clearReconnect, clearHeartbeat, clearDebounce]);

    useEffect(() => { saveLS(LS_TEXT_KEY, text); }, [text]);
    useEffect(() => { saveLS(LS_IMAGES_KEY, images.slice(-MAX_CACHED_IMAGES).map(({ sender, ...rest }) => rest)); }, [images]);
    useEffect(() => {
        if (panelOpen) setHasNewData(false);
    }, [panelOpen]);

    const clearNewDataFlag = useCallback(() => { setHasNewData(false); }, []);

    const sendText = useCallback((content: string) => {
        setText(content);
        clearDebounce();
        debounceRef.current = setTimeout(() => {
            safeSend({ type: 'text', content, sender: deviceNameRef.current });
        }, DEBOUNCE_MS);
    }, [clearDebounce, safeSend]);

    const sendImage = useCallback((data: string, mime: string) => {
        safeSend({ type: 'image', data, mime, sender: deviceNameRef.current });
        setImages(prev => [...prev, { data, mime, sender: deviceNameRef.current }]);
    }, [safeSend]);

    const syncClipboard = useCallback((content: string) => {
        safeSend({ type: 'sync_clipboard', content, sender: deviceNameRef.current });
    }, [safeSend]);

    const clearImages = useCallback(() => {
        setImages([]);
        try { localStorage.removeItem(LS_IMAGES_KEY); } catch {}
    }, []);

    const connected = connectionState === 'connected';
    const connecting = connectionState === 'connecting';

    return {
        text,
        images,
        connected,
        connecting,
        hasNewData,
        pendingCount,
        deviceName,
        clearNewDataFlag,
        sendText,
        sendImage,
        syncClipboard,
        clearImages,
    };
}

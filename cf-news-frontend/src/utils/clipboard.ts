export const MAX_HISTORY = 20;
export type ClipboardTransport = 'http' | 'wss';

export interface ClipboardHistoryItem {
    id: string;
    type: 'text' | 'image' | 'file';
    content?: string;
    data?: string;
    mime?: string;
    fileName?: string;
    fileSize?: number;
    createdAt: number;
}

export function historyKey(userId: string): string {
    return userId ? `cb_history_${userId}` : 'cb_history';
}

export function richHistoryKey(userId: string): string {
    return userId ? `cb_rich_history_${userId}` : 'cb_rich_history';
}

export function trustedDevicesKey(userId: string): string {
    return userId ? `cb_trusted_devices_${userId}` : 'cb_trusted_devices';
}

export function transportKey(userId: string): string {
    return userId ? `cb_transport_${userId}` : 'cb_transport';
}

export function privateModeKey(userId: string): string {
    return userId ? `cb_private_mode_${userId}` : 'cb_private_mode';
}

export function autoAcceptKey(userId: string): string {
    return userId ? `cb_auto_accept_${userId}` : 'cb_auto_accept';
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

export function loadHistory(userId: string): string[] {
    try { const v = localStorage.getItem(historyKey(userId)); return v ? JSON.parse(v) : []; } catch { return []; }
}

export function saveHistory(userId: string, items: string[]) {
    try { localStorage.setItem(historyKey(userId), JSON.stringify(items.slice(0, MAX_HISTORY))); } catch {}
}

function normalizeHistoryText(text?: string): string {
    return (text || '').trim();
}

export function appendHistory(userId: string, text: string) {
    const normalized = normalizeHistoryText(text);
    if (!normalized) return;
    const history = loadHistory(userId);
    const filtered = history.filter(h => normalizeHistoryText(h) !== normalized);
    filtered.unshift(text);
    saveHistory(userId, filtered);
}

export function clearHistory(userId: string) {
    try { localStorage.removeItem(historyKey(userId)); } catch {}
    try { localStorage.removeItem(richHistoryKey(userId)); } catch {}
}

export function loadRichHistory(userId: string): ClipboardHistoryItem[] {
    try {
        const v = localStorage.getItem(richHistoryKey(userId));
        const parsed = v ? JSON.parse(v) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

export function appendRichHistory(userId: string, item: Omit<ClipboardHistoryItem, 'id' | 'createdAt'>) {
    const normalizedText = item.type === 'text' ? normalizeHistoryText(item.content) : '';
    if (item.type === 'text' && !normalizedText) return;
    const history = loadRichHistory(userId);
    const next: ClipboardHistoryItem = {
        ...item,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
    };
    const deduped = history.filter(h => {
        if (item.type === 'text') return normalizeHistoryText(h.content) !== normalizedText;
        if (item.type === 'file') return h.fileName !== item.fileName || h.fileSize !== item.fileSize;
        return h.data !== item.data;
    });
    try { localStorage.setItem(richHistoryKey(userId), JSON.stringify([next, ...deduped].slice(0, MAX_HISTORY))); } catch {}
}

export function removeTextHistory(userId: string, text: string) {
    const normalized = normalizeHistoryText(text);
    if (!normalized) return;
    saveHistory(userId, loadHistory(userId).filter(h => normalizeHistoryText(h) !== normalized));
    const richHistory = loadRichHistory(userId).filter(h => h.type !== 'text' || normalizeHistoryText(h.content) !== normalized);
    try { localStorage.setItem(richHistoryKey(userId), JSON.stringify(richHistory.slice(0, MAX_HISTORY))); } catch {}
}

export function loadTrustedDevices(userId: string): string[] {
    try {
        const v = localStorage.getItem(trustedDevicesKey(userId));
        const parsed = v ? JSON.parse(v) : [];
        return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
}

export function saveTrustedDevices(userId: string, ids: string[]) {
    try { localStorage.setItem(trustedDevicesKey(userId), JSON.stringify(Array.from(new Set(ids)).slice(0, 50))); } catch {}
}

export function loadTransport(userId: string): ClipboardTransport {
    try {
        const v = localStorage.getItem(transportKey(userId));
        return v === 'wss' ? 'wss' : 'http';
    } catch { return 'http'; }
}

export function saveTransport(userId: string, transport: ClipboardTransport) {
    try { localStorage.setItem(transportKey(userId), transport); } catch {}
}

export function loadPrivateMode(userId: string): boolean {
    try { return localStorage.getItem(privateModeKey(userId)) === '1'; } catch { return false; }
}

export function savePrivateMode(userId: string, enabled: boolean) {
    try { localStorage.setItem(privateModeKey(userId), enabled ? '1' : '0'); } catch {}
}

export function loadAutoAccept(userId: string): boolean {
    try { return localStorage.getItem(autoAcceptKey(userId)) === '1'; } catch { return false; }
}

export function saveAutoAccept(userId: string, enabled: boolean) {
    try { localStorage.setItem(autoAcceptKey(userId), enabled ? '1' : '0'); } catch {}
}

export const MAX_HISTORY = 20;

export function historyKey(userId: string): string {
    return userId ? `cb_history_${userId}` : 'cb_history';
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

export function appendHistory(userId: string, text: string) {
    if (!text.trim()) return;
    const history = loadHistory(userId);
    const filtered = history.filter(h => h !== text);
    filtered.unshift(text);
    saveHistory(userId, filtered);
}

export function clearHistory(userId: string) {
    try { localStorage.removeItem(historyKey(userId)); } catch {}
}

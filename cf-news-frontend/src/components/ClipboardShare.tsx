import { useState, useRef } from 'react';

interface Props {
    visible: boolean;
    onClose: () => void;
    text: string;
    images: { data: string; mime: string; sender?: string }[];
    connected: boolean;
    connecting: boolean;
    pendingCount: number;
    deviceName: string;
    onSendText: (content: string) => void;
    onSendImage: (data: string, mime: string) => void;
    onSyncClipboard: (content: string) => void;
    onClearImages: () => void;
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const LS_HISTORY_KEY = 'cb_history';
const MAX_HISTORY = 20;

function loadHistory(): string[] {
    try { const v = localStorage.getItem(LS_HISTORY_KEY); return v ? JSON.parse(v) : []; } catch { return []; }
}

function saveHistory(items: string[]) {
    try { localStorage.setItem(LS_HISTORY_KEY, JSON.stringify(items.slice(0, MAX_HISTORY))); } catch {}
}

function appendHistory(text: string) {
    if (!text.trim()) return;
    const history = loadHistory();
    const filtered = history.filter(h => h !== text);
    filtered.unshift(text);
    saveHistory(filtered);
}

function compressImage(blob: Blob): Promise<Blob> {
    return new Promise((resolve) => {
        if (blob.size <= MAX_IMAGE_SIZE) { resolve(blob); return; }
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let { width, height } = img;
            // Scale down proportionally until estimated size fits
            const ratio = Math.sqrt(MAX_IMAGE_SIZE / blob.size) * 0.9;
            canvas.width = Math.round(width * ratio);
            canvas.height = Math.round(height * ratio);
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            canvas.toBlob((compressed) => {
                if (compressed) resolve(compressed);
                else resolve(blob);
            }, blob.type === 'image/gif' ? 'image/jpeg' : blob.type, 0.85);
        };
        img.onerror = () => resolve(blob);
        img.src = URL.createObjectURL(blob);
    });
}

export default function ClipboardShare({
    visible, onClose, text, images, connected, connecting, pendingCount, deviceName,
    onSendText, onSendImage, onSyncClipboard, onClearImages,
}: Props) {
    const [status, setStatus] = useState('');
    const [previewImg, setPreviewImg] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    function handleTextChange(value: string) {
        onSendText(value);
    }

    async function processImageBlob(blob: Blob) {
        if (blob.size > MAX_IMAGE_SIZE) {
            setStatus(`压缩中 (${(blob.size / 1024 / 1024).toFixed(1)}MB → ...)`);
            const compressed = await compressImage(blob);
            const originalMB = (blob.size / 1024 / 1024).toFixed(1);
            const compressedMB = (compressed.size / 1024 / 1024).toFixed(1);
            setStatus(`已压缩 ${originalMB}→${compressedMB}MB`);
            setTimeout(() => setStatus(''), 2000);
            const reader = new FileReader();
            reader.onload = () => {
                const b64 = (reader.result as string).split(',')[1];
                onSendImage(b64, compressed.type);
            };
            reader.readAsDataURL(compressed);
        } else {
            const reader = new FileReader();
            reader.onload = () => {
                const b64 = (reader.result as string).split(',')[1];
                onSendImage(b64, blob.type);
            };
            reader.readAsDataURL(blob);
        }
    }

    async function handlePaste(e?: React.ClipboardEvent) {
        try {
            // Priority 1: Use clipboardData from paste event (works on mobile)
            if (e) {
                const items = e.clipboardData?.items;
                if (items) {
                    for (let i = 0; i < items.length; i++) {
                        if (items[i].type.startsWith('image/')) {
                            e.preventDefault();
                            const file = items[i].getAsFile();
                            if (file) { await processImageBlob(file); return; }
                        }
                    }
                }
            }
            // Priority 2: Async Clipboard API (desktop only, requires permission)
            if (navigator.clipboard?.read) {
                const items = await navigator.clipboard.read();
                for (const item of items) {
                    const imageType = item.types.find(t => t.startsWith('image/'));
                    if (imageType) {
                        const blob = await item.getType(imageType);
                        await processImageBlob(blob);
                        return;
                    }
                }
            }
        } catch {}
    }

    function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (file && file.type.startsWith('image/')) {
            processImageBlob(file);
        }
        // Reset input so the same file can be selected again
        if (fileInputRef.current) fileInputRef.current.value = '';
    }

    function handleSync() {
        if (text.trim()) {
            onSyncClipboard(text);
            appendHistory(text);
            setStatus('✅ 已推送到其他设备剪贴板');
            setTimeout(() => setStatus(''), 2000);
        }
    }

    const history = loadHistory();

    return (
        <>
            {visible && <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />}
            <div className={`fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-50 border-l border-gray-200 transform transition-transform duration-300 ${visible ? 'translate-x-0' : 'translate-x-full'}`}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                    <div className="flex items-center gap-2">
                        <h2 className="text-base font-semibold text-gray-900">📋 共享粘贴板</h2>
                        <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-emerald-500' : connecting ? 'bg-amber-400 animate-pulse' : 'bg-red-400'}`} />
                        <span className="text-[10px] text-gray-400">{deviceName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {pendingCount > 0 && (
                            <span className="text-[11px] text-amber-500 font-medium">{pendingCount} 待发送</span>
                        )}
                        {status && <span className="text-[11px] text-gray-400">{status}</span>}
                        <button className="w-7 h-7 rounded-full bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600 transition flex items-center justify-center text-sm" onClick={onClose}>✕</button>
                    </div>
                </div>

                <div className="p-4 overflow-y-auto h-[calc(100%-60px)]">
                    <textarea
                        className="w-full h-24 px-3.5 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-900 outline-none focus:border-indigo-500 focus:bg-white transition resize-none placeholder:text-gray-400"
                        placeholder="在此粘贴或输入文本，其他设备将实时同步..."
                        value={text}
                        onChange={e => handleTextChange(e.target.value)}
                        onPaste={e => handlePaste(e)}
                    />
                    {/* Primary CTA: push to other devices */}
                    {text && (
                        <button
                            className="mt-2 w-full px-4 py-2 bg-emerald-500 text-white rounded-lg text-[13px] font-medium hover:bg-emerald-600 transition active:scale-[0.98]"
                            onClick={handleSync}
                        >
                            📤 推送到其他设备
                        </button>
                    )}
                    {/* Secondary utilities */}
                    <div className="flex items-center gap-3 mt-1.5">
                        <button className="text-[11px] text-gray-400 hover:text-indigo-500 transition" onClick={() => fileInputRef.current?.click()}>
                            📷 选择图片
                        </button>
                        {text && (
                            <button className="text-[11px] text-gray-400 hover:text-indigo-500 transition" onClick={() => { navigator.clipboard.writeText(text); setStatus('✅ 文本已复制'); setTimeout(() => setStatus(''), 1500); }}>
                                📄 复制文本
                            </button>
                        )}
                        {history.length > 0 && (
                            <button
                                className="text-[11px] text-gray-400 hover:text-gray-600 transition"
                                onClick={() => setShowHistory(!showHistory)}
                            >
                                📜 历史 ({history.length})
                            </button>
                        )}
                    </div>
                    <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />

                    {/* History dropdown */}
                    {showHistory && history.length > 0 && (
                        <div className="mt-2 border border-gray-200 rounded-xl bg-gray-50 max-h-40 overflow-y-auto">
                            {history.map((h, i) => (
                                <button
                                    key={i}
                                    className="w-full text-left px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-100 border-b border-gray-100 last:border-b-0 truncate"
                                    onClick={() => { onSendText(h); appendHistory(h); setShowHistory(false); }}
                                >
                                    {h}
                                </button>
                            ))}
                        </div>
                    )}

                    {images.length > 0 && (
                        <div className="mt-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-[12px] text-gray-400">图片 ({images.length})</span>
                                <button className="text-[11px] text-red-400 hover:text-red-500 transition" onClick={onClearImages}>清除</button>
                            </div>
                            <div className="flex gap-2 flex-wrap">
                                {images.map((img, i) => (
                                    <div key={i} className="relative group">
                                        <img src={`data:${img.mime};base64,${img.data}`}
                                            className="w-20 h-20 object-cover rounded-lg border border-gray-200 cursor-pointer hover:opacity-80 transition"
                                            onClick={() => setPreviewImg(`data:${img.mime};base64,${img.data}`)} alt="" />
                                        <button className="absolute bottom-0.5 right-0.5 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded active:bg-black/80 transition" onClick={async (e) => {
                                            e.stopPropagation();
                                            try {
                                                if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
                                                    setStatus('浏览器不支持复制图片');
                                                    setTimeout(() => setStatus(''), 2000);
                                                    return;
                                                }
                                                const imgEl = e.currentTarget.parentElement?.querySelector('img');
                                                if (!imgEl) return;
                                                const canvas = document.createElement('canvas');
                                                canvas.width = imgEl.naturalWidth;
                                                canvas.height = imgEl.naturalHeight;
                                                canvas.getContext('2d')!.drawImage(imgEl, 0, 0);
                                                const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'));
                                                if (!blob) throw new Error('toBlob failed');
                                                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
                                                setStatus('✅ 图片已复制');
                                                setTimeout(() => setStatus(''), 1500);
                                            } catch (err) {
                                                console.error('Copy image failed:', err);
                                                setStatus('复制失败');
                                                setTimeout(() => setStatus(''), 2000);
                                            }
                                        }}>复制</button>
                                        {img.sender && <span className="absolute top-0.5 left-0.5 bg-black/50 text-white text-[8px] px-1 py-0.5 rounded">{img.sender}</span>}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="mt-3 flex flex-col gap-2 text-[12px] text-gray-400">
                        <span>📄 文本实时同步</span>
                        <span>🖼 图片 ≤5MB（超限自动压缩，支持粘贴/选择/拍照）</span>
                        <span>📤 有文本时点击按钮推送</span>
                        {!connected && !connecting && <span className="text-red-400">⚠ 未连接</span>}
                        {connecting && <span className="text-amber-400">🔄 重连中...</span>}
                    </div>
                    <div className="mt-2 px-3 py-2 bg-gray-50 rounded-lg text-[10px] text-gray-400 leading-relaxed">
                        🔒 数据仅在你的设备间传输，服务端不永久存储。通过 WSS 加密传输，仅同一账号可见。离线设备上线后会自动接收推送。
                    </div>
                </div>
            </div>
            {previewImg && (
                <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-8" onClick={() => setPreviewImg(null)}>
                    <img src={previewImg} className="max-w-full max-h-full object-contain rounded-lg" alt="preview" />
                </div>
            )}
        </>
    );
}

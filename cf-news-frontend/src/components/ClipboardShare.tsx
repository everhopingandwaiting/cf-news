import { useState, useRef } from 'react';

interface IncomingFileOffer {
    transferId: string;
    fileName: string;
    fileSize: number;
    mime: string;
    totalChunks: number;
}

interface FileTransfer {
    transferId: string;
    fileName: string;
    fileSize: number;
    mime: string;
    totalChunks: number;
    receivedChunks: number;
    direction: 'send' | 'receive';
    status: 'offering' | 'accepted' | 'transferring' | 'complete' | 'cancelled' | 'rejected';
    progress: number;
    startedAt: number;
    completedAt?: number;
}

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
    incomingOffers: IncomingFileOffer[];
    fileTransfers: FileTransfer[];
    onSendFile: (file: File) => void;
    onAcceptFile: (transferId: string) => void;
    onRejectFile: (transferId: string) => void;
    onCancelFile: (transferId: string) => void;
}

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const LS_HISTORY_KEY = 'cb_history';
const MAX_HISTORY = 20;

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

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
    incomingOffers, fileTransfers, onSendFile, onAcceptFile, onRejectFile, onCancelFile,
}: Props) {
    const [status, setStatus] = useState('');
const [previewImg, setPreviewImg] = useState<string | null>(null);
const [showHistory, setShowHistory] = useState(false);
const [isDragOver, setIsDragOver] = useState(false);
const [expandedTimeId, setExpandedTimeId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const fileTransferInputRef = useRef<HTMLInputElement>(null);

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

    function handleDragOver(e: React.DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(true);
    }

    function handleDragLeave(e: React.DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
    }

    function handleDrop(e: React.DragEvent) {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        const files = e.dataTransfer.files;
        if (files.length > 0) {
            onSendFile(files[0]);
        }
    }

    function handleFileTransferSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (file) onSendFile(file);
        if (fileTransferInputRef.current) fileTransferInputRef.current.value = '';
    }

    const history = loadHistory();

    return (
        <>
            {visible && <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} />}
            <div className={`fixed top-0 right-0 h-full w-full max-w-md bg-white shadow-2xl z-50 border-l border-gray-200 transform transition-transform duration-300 ${visible ? 'translate-x-0' : 'translate-x-full'}`}>
                {/* Header - stays outside scrollable area */}
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

                {/* Scrollable panel body with drag-drop */}
                <div 
                    className="p-4 overflow-y-auto h-[calc(100%-60px)] relative"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    {/* Drag overlay - covers entire panel */}
                    {isDragOver && (
                        <div className="absolute inset-0 bg-indigo-500/10 border-2 border-indigo-500 border-dashed rounded-lg flex items-center justify-center z-10">
                            <div className="text-center">
                                <span className="text-3xl">📂</span>
                                <p className="text-sm text-indigo-600 font-medium mt-1">释放文件以发送</p>
                            </div>
                        </div>
                    )}

                    {/* Section 1: 📝 文本共享 */}
                    <div className="bg-gray-50/50 border border-gray-200 rounded-xl p-3.5 mb-3">
                        <div className="flex items-center justify-between mb-2.5">
                            <h3 className="text-[13px] font-medium text-gray-700">📝 文本共享</h3>
                            <span className="text-[10px] text-gray-400">📄 文本实时同步</span>
                        </div>
                        <textarea
                            className="w-full h-24 px-3.5 py-3 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500 focus:bg-white transition resize-none placeholder:text-gray-400"
                            placeholder="在此粘贴或输入文本，其他设备将实时同步..."
                            value={text}
                            onChange={e => handleTextChange(e.target.value)}
                            onPaste={e => handlePaste(e)}
                        />
                        {/* Push hint & button */}
                        <div className="mt-2 flex flex-col gap-1">
                            <span className="text-[11px] text-gray-400 text-center">📤 有文本时可点击按钮推送到其他设备剪贴板</span>
                            {text && (
                                <button
                                    className="w-full px-4 py-2 bg-emerald-500 text-white rounded-lg text-[13px] font-medium hover:bg-emerald-600 transition active:scale-[0.98]"
                                    onClick={handleSync}
                                >
                                    📤 推送到其他设备
                                </button>
                            )}
                        </div>
                        {/* Text actions row */}
                        <div className="flex items-center gap-3 mt-2">
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
                        {/* History dropdown */}
                        {showHistory && history.length > 0 && (
                            <div className="mt-2 border border-gray-200 rounded-lg bg-white max-h-40 overflow-y-auto">
                                {history.map((h, i) => (
                                    <button
                                        key={i}
                                        className="w-full text-left px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 truncate"
                                        onClick={() => { onSendText(h); appendHistory(h); setShowHistory(false); }}
                                    >
                                        {h}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Section 2: 🖼 图片共享 */}
                    <div className="bg-gray-50/50 border border-gray-200 rounded-xl p-3.5 mb-3">
                        <div className="flex items-center justify-between mb-2.5">
                            <h3 className="text-[13px] font-medium text-gray-700">🖼 图片共享</h3>
                            <div className="flex items-center gap-2">
                                {images.length > 0 && (
                                    <>
                                        <span className="text-[10px] text-gray-400">{images.length}</span>
                                        <button className="text-[10px] text-red-400 hover:text-red-500 transition" onClick={onClearImages}>清除</button>
                                    </>
                                )}
                                <span className="text-[10px] text-gray-400">≤5MB 超限自动压缩</span>
                                <button className="text-[11px] text-gray-400 hover:text-indigo-500 transition" onClick={() => fileInputRef.current?.click()}>
                                    📷 选择图片
                                </button>
                            </div>
                        </div>
                        <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleFileSelect} />
                        {images.length > 0 ? (
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
                        ) : (
                            <div className="text-[12px] text-gray-400 py-2">
                                支持粘贴、选择图片或直接拍照，超 5MB 自动压缩
                            </div>
                        )}
                    </div>

                    {/* Section 3: 📁 文件共享 */}
                    <div className="bg-gray-50/50 border border-gray-200 rounded-xl p-3.5 mb-3">
                        <div className="flex items-center justify-between mb-2.5">
                            <h3 className="text-[13px] font-medium text-gray-700">📁 文件共享</h3>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-gray-400">支持拖拽</span>
                                {fileTransfers.length > 0 && (
                                    <span className="text-[10px] text-gray-400">{fileTransfers.length}</span>
                                )}
                                <button className="text-[11px] text-gray-400 hover:text-indigo-500 transition" onClick={() => fileTransferInputRef.current?.click()}>
                                    📎 选择文件
                                </button>
                            </div>
                        </div>
                        <input ref={fileTransferInputRef} type="file" accept="*/*" className="hidden" onChange={handleFileTransferSelect} />
                        {fileTransfers.length > 0 ? (
                            <div className="flex flex-col gap-2 max-h-[180px] overflow-y-auto">
                                {[...fileTransfers].sort((a, b) => b.startedAt - a.startedAt).slice(0, 3).map((transfer) => (
                                    <div key={transfer.transferId} className="bg-white border border-gray-200 rounded-lg px-3 py-2">
                                        <div className="flex items-center justify-between">
                                            <div className="flex items-center gap-1.5">
                                                <span className="text-sm">{transfer.direction === 'send' ? '↑' : '↓'}</span>
                                                <span className="text-[12px] text-gray-700 truncate max-w-[150px]">{transfer.fileName}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[10px] text-gray-400">{formatFileSize(transfer.fileSize)}</span>
                                                {(transfer.status === 'offering' || transfer.status === 'transferring') && (
                                                    <button 
                                                        className="text-[10px] text-red-400 hover:text-red-500 transition"
                                                        onClick={() => onCancelFile(transfer.transferId)}
                                                    >
                                                        ✕
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                        <div className="mt-1.5 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                            <div 
                                                className="bg-indigo-500 h-full transition-all duration-200"
                                                style={{ width: `${transfer.progress}%` }}
                                            />
                                        </div>
                                        <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
                                            <span>
                                                {transfer.status === 'offering' && '等待对方接受...'}
                                                {transfer.status === 'accepted' && '已接受，准备传输...'}
                                                {transfer.status === 'transferring' && `${transfer.progress}%`}
                                                {transfer.status === 'complete' && '✓ 完成'}
                                                {transfer.status === 'cancelled' && '已取消'}
                                                {transfer.status === 'rejected' && '已拒绝'}
                                            </span>
                                            <span className="text-[9px] cursor-pointer hover:text-indigo-500"
                                                onClick={() => setExpandedTimeId(expandedTimeId === transfer.transferId ? null : transfer.transferId)}>
                                                {expandedTimeId === transfer.transferId
                                                    ? new Date(transfer.startedAt).toLocaleString('zh-CN') + (transfer.completedAt ? ` → ${new Date(transfer.completedAt).toLocaleString('zh-CN')}` : '')
                                                    : new Date(transfer.startedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
                                                      + (transfer.completedAt ? `→${new Date(transfer.completedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}` : '')
                                                }
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="text-[12px] text-gray-400 py-2">
                                支持拖拽或选择文件发送，不限大小，取决于网络稳定性
                            </div>
                        )}
                    </div>

                    {/* Connection status & security info */}
                    {!connected && !connecting && <span className="text-[12px] text-red-400">⚠ 未连接</span>}
                    {connecting && <span className="text-[12px] text-amber-400">🔄 重连中...</span>}
                    <div className="mt-2 px-3 py-2 bg-gray-50 rounded-lg text-[10px] text-gray-400 leading-relaxed">
                        🔒 数据仅在你的设备间传输，服务端不永久存储。通过 WSS 加密传输，仅同一账号可见。离线设备上线后会自动接收推送。
                    </div>
                </div>
            </div>
            {/* Image preview modal */}
            {previewImg && (
                <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-8" onClick={() => setPreviewImg(null)}>
                    <img src={previewImg} className="max-w-full max-h-full object-contain rounded-lg" alt="preview" />
                </div>
            )}
            {/* Incoming file offer modal */}
            {incomingOffers.length > 0 && (
                <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 border border-gray-200">
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-2xl">📥</span>
                            <span className="text-sm font-medium text-gray-900">收到文件传输请求</span>
                        </div>
                        {incomingOffers.map((offer) => (
                            <div key={offer.transferId} className="bg-gray-50 rounded-lg p-3 mb-3 last:mb-0">
                                <div className="flex items-center gap-2">
                                    <span className="text-[13px] text-gray-700 truncate max-w-[220px]">{offer.fileName}</span>
                                </div>
                                <div className="text-[11px] text-gray-400 mt-1">{formatFileSize(offer.fileSize)}</div>
                                <div className="flex gap-2 mt-2.5">
                                    <button 
                                        className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[12px] font-medium hover:bg-emerald-600 transition active:scale-[0.98]"
                                        onClick={() => onAcceptFile(offer.transferId)}
                                    >
                                        ✓ 接受
                                    </button>
                                    <button 
                                        className="px-3 py-1.5 bg-gray-200 text-gray-600 rounded-lg text-[12px] font-medium hover:bg-gray-300 transition active:scale-[0.98]"
                                        onClick={() => onRejectFile(offer.transferId)}
                                    >
                                        ✕ 拒绝
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
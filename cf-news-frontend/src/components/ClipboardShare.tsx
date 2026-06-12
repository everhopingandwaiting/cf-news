import { useState, useRef, useEffect } from 'react';
import {
    loadHistory, appendHistory, clearHistory,
    loadRichHistory, appendRichHistory, loadTrustedDevices, saveTrustedDevices,
    loadTransport, saveTransport, loadPrivateMode, savePrivateMode,
    loadAutoAccept, saveAutoAccept,
} from '../utils/clipboard';
import { compressImage } from '../utils/image';
import type { ClipboardTransport } from '../utils/clipboard';
import type { ClipboardShareProps } from './clipboard/types';
import TextSharingSection from './clipboard/TextSharingSection';
import ImageSharingSection from './clipboard/ImageSharingSection';
import FileSharingSection from './clipboard/FileSharingSection';
import DeviceSecuritySection from './clipboard/DeviceSecuritySection';
import ImagePreviewModal from './clipboard/ImagePreviewModal';
import IncomingOfferModal from './clipboard/IncomingOfferModal';

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

export default function ClipboardShare({
    visible, onClose, userId, text, images, connected, connecting, pendingCount, deviceName,
    onSendText, onSendImage, onSyncClipboard, onClearImages,
    incomingOffers, fileTransfers, devices, currentDeviceId,
    onSendFile, onAcceptFile, onRejectFile, onCancelFile,
}: ClipboardShareProps) {
    const [status, setStatus] = useState('');
    const [previewImg, setPreviewImg] = useState<string | null>(null);
    const [showHistory, setShowHistory] = useState(false);
    const [showDevices, setShowDevices] = useState(false);
    const [isDragOver, setIsDragOver] = useState(false);
    const [transport, setTransport] = useState<ClipboardTransport>(() => loadTransport(userId));
    const [trustedDevices, setTrustedDevices] = useState<string[]>(() => loadTrustedDevices(userId));
    const [privateMode, setPrivateMode] = useState(() => loadPrivateMode(userId));
    const [autoAccept, setAutoAccept] = useState(() => loadAutoAccept(userId));
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const [autoAcceptRemaining, setAutoAcceptRemaining] = useState<number>(0);

    useEffect(() => {
        const autoOffers = autoAccept
            ? incomingOffers
            : incomingOffers.filter(o => o.deviceId && trustedDevices.includes(o.deviceId));
        if (autoOffers.length > 0) {
            setAutoAcceptRemaining(5);
            timerRef.current = setTimeout(() => {
                for (const offer of autoOffers) {
                    onAcceptFile(offer.transferId);
                }
                setAutoAcceptRemaining(0);
            }, 5000);
        } else {
            if (timerRef.current) {
                clearTimeout(timerRef.current);
                timerRef.current = null;
            }
            setAutoAcceptRemaining(0);
        }
        const interval = setInterval(() => {
            setAutoAcceptRemaining(prev => prev > 0 ? prev - 1 : 0);
        }, 1000);
        return () => {
            if (timerRef.current) clearTimeout(timerRef.current);
            clearInterval(interval);
        };
    }, [autoAccept, incomingOffers, onAcceptFile, trustedDevices]);

    useEffect(() => { saveTransport(userId, transport); }, [userId, transport]);
    useEffect(() => { saveTrustedDevices(userId, trustedDevices); }, [userId, trustedDevices]);
    useEffect(() => { savePrivateMode(userId, privateMode); }, [userId, privateMode]);
    useEffect(() => { saveAutoAccept(userId, autoAccept); }, [userId, autoAccept]);

    function handleManualAccept(transferId: string) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        setAutoAcceptRemaining(0);
        onAcceptFile(transferId);
    }

    function handleManualReject(transferId: string) {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = null;
        setAutoAcceptRemaining(0);
        onRejectFile(transferId);
    }

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
                if (!privateMode) appendRichHistory(userId, { type: 'image', data: b64, mime: compressed.type });
            };
            reader.readAsDataURL(compressed);
        } else {
            const reader = new FileReader();
            reader.onload = () => {
                const b64 = (reader.result as string).split(',')[1];
                onSendImage(b64, blob.type);
                if (!privateMode) appendRichHistory(userId, { type: 'image', data: b64, mime: blob.type });
            };
            reader.readAsDataURL(blob);
        }
    }

    async function handlePaste(e?: React.ClipboardEvent) {
        try {
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

    function handleSync() {
        if (text.trim()) {
            onSyncClipboard(text);
            if (!privateMode) {
                appendHistory(userId, text);
                appendRichHistory(userId, { type: 'text', content: text });
            }
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
            onSendFile(files[0], transport);
            if (!privateMode) appendRichHistory(userId, { type: 'file', fileName: files[0].name, fileSize: files[0].size, mime: files[0].type });
        }
    }

    function handleFileTransferSend(file: File) {
        onSendFile(file, transport);
        if (!privateMode) appendRichHistory(userId, { type: 'file', fileName: file.name, fileSize: file.size, mime: file.type });
    }

    function handleCreateTemporaryLink() {
        if (!text.trim()) return;
        const encoded = btoa(unescape(encodeURIComponent(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        const url = `${window.location.origin}${window.location.pathname}#clip=${encoded}`;
        navigator.clipboard.writeText(url).then(() => {
            setStatus('✅ 临时投递链接已复制');
            setTimeout(() => setStatus(''), 2000);
        }).catch(() => setStatus('复制链接失败'));
    }

    function handleCopyText() {
        navigator.clipboard.writeText(text);
        setStatus('✅ 文本已复制');
        setTimeout(() => setStatus(''), 1500);
    }

    function handleClearHistory() {
        clearHistory(userId);
        setShowHistory(false);
        setStatus('历史已清除');
        setTimeout(() => setStatus(''), 1200);
    }

    function handleImageCopy(imgData: string, imgMime: string) {
        (async () => {
            try {
                if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
                    setStatus('浏览器不支持复制图片');
                    setTimeout(() => setStatus(''), 2000);
                    return;
                }
                const imgEl = document.querySelector(`img[src="data:${imgMime};base64,${imgData}"]`);
                if (!imgEl) return;
                const canvas = document.createElement('canvas');
                canvas.width = (imgEl as HTMLImageElement).naturalWidth;
                canvas.height = (imgEl as HTMLImageElement).naturalHeight;
                canvas.getContext('2d')!.drawImage(imgEl as HTMLImageElement, 0, 0);
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
        })();
    }

    function handleToggleTrustedDevice(deviceId: string) {
        setTrustedDevices(prev => prev.includes(deviceId) ? prev.filter(id => id !== deviceId) : [...prev, deviceId]);
    }

    const history = loadHistory(userId);
    const richHistory = loadRichHistory(userId);

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

                <div 
                    className="p-4 overflow-y-auto h-[calc(100%-60px)] relative"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    {isDragOver && (
                        <div className="absolute inset-0 bg-indigo-500/10 border-2 border-indigo-500 border-dashed rounded-lg flex items-center justify-center z-10">
                            <div className="text-center">
                                <span className="text-3xl">📂</span>
                                <p className="text-sm text-indigo-600 font-medium mt-1">释放文件以发送</p>
                            </div>
                        </div>
                    )}

                    <TextSharingSection
                        text={text}
                        onTextChange={handleTextChange}
                        onPaste={handlePaste}
                        onSync={handleSync}
                        onCopyText={handleCopyText}
                        onTemporaryLink={handleCreateTemporaryLink}
                        history={history}
                        richHistory={richHistory}
                        showHistory={showHistory}
                        onToggleHistory={() => setShowHistory(!showHistory)}
                        onClearHistory={handleClearHistory}
                        onSelectHistory={(content) => { onSendText(content); setShowHistory(false); }}
                    />

                    <ImageSharingSection
                        images={images}
                        onClearImages={onClearImages}
                        onFileSelect={processImageBlob}
                        onImageCopy={handleImageCopy}
                        onPreview={setPreviewImg}
                    />

                    <FileSharingSection
                        fileTransfers={fileTransfers}
                        transport={transport}
                        onTransportChange={setTransport}
                        onSendFile={handleFileTransferSend}
                        onCancelFile={onCancelFile}
                    />

                    <DeviceSecuritySection
                        devices={devices}
                        currentDeviceId={currentDeviceId}
                        trustedDevices={trustedDevices}
                        onToggleTrusted={handleToggleTrustedDevice}
                        privateMode={privateMode}
                        onPrivateModeChange={setPrivateMode}
                        autoAccept={autoAccept}
                        onAutoAcceptChange={setAutoAccept}
                        showDevices={showDevices}
                        onToggleShowDevices={() => setShowDevices(!showDevices)}
                    />

                    {!connected && !connecting && <span className="text-[12px] text-red-400">⚠ 未连接</span>}
                    {connecting && <span className="text-[12px] text-amber-400">🔄 重连中...</span>}
                    <div className="mt-2 px-3 py-2 bg-gray-50 rounded-lg text-[10px] text-gray-400 leading-relaxed">
                        🔒 数据仅在你的设备间传输，服务端不永久存储。HTTP 文件传输需同账号 token，WSS 用于实时控制与兼容传输。
                    </div>
                </div>
            </div>
            <ImagePreviewModal src={previewImg} onClose={() => setPreviewImg(null)} />
            <IncomingOfferModal
                offers={incomingOffers}
                autoAccept={autoAccept}
                trustedDevices={trustedDevices}
                autoAcceptRemaining={autoAcceptRemaining}
                onAccept={handleManualAccept}
                onReject={handleManualReject}
            />
        </>
    );
}

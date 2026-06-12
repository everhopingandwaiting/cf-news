import { useRef, useState } from 'react';
import type { ClipboardTransport } from '../../utils/clipboard';
import { formatFileSize } from '../../utils/clipboard';
import type { FileTransfer } from './types';

interface Props {
    fileTransfers: FileTransfer[];
    transport: ClipboardTransport;
    onTransportChange: (t: ClipboardTransport) => void;
    onSendFile: (file: File) => void;
    onCancelFile: (transferId: string) => void;
}

export default function FileSharingSection({ fileTransfers, transport, onTransportChange, onSendFile, onCancelFile }: Props) {
    const fileTransferInputRef = useRef<HTMLInputElement>(null);
    const [expandedTimeId, setExpandedTimeId] = useState<string | null>(null);

    function handleFileTransferSelect(e: React.ChangeEvent<HTMLInputElement>) {
        const file = e.target.files?.[0];
        if (file) {
            onSendFile(file);
        }
        if (fileTransferInputRef.current) fileTransferInputRef.current.value = '';
    }

    function handleRetry() {
        fileTransferInputRef.current?.click();
    }

    return (
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
            <div className="mb-2 grid grid-cols-2 gap-2">
                <button
                    className={`px-3 py-1.5 rounded-lg border text-[12px] ${transport === 'http' ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-gray-600 border-gray-200'}`}
                    onClick={() => onTransportChange('http')}
                    title="适合 100MB 内文件，走 HTTP 流式通道"
                >
                    HTTP 流 ≤100MB
                </button>
                <button
                    className={`px-3 py-1.5 rounded-lg border text-[12px] ${transport === 'wss' ? 'bg-indigo-500 text-white border-indigo-500' : 'bg-white text-gray-600 border-gray-200'}`}
                    onClick={() => onTransportChange('wss')}
                    title="适合大文件，走 WebSocket 分片"
                >
                    WSS 大文件
                </button>
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
                                    <span className="text-[9px] text-gray-400 uppercase">{transfer.transport}</span>
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
                                    {(transfer.status === 'cancelled' || transfer.status === 'rejected') && (
                                        <button
                                            className="text-[10px] text-indigo-500 hover:text-indigo-600 transition"
                                            onClick={handleRetry}
                                        >
                                            重试
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
                                    {transfer.status === 'cancelled' && (transfer.error || '已取消')}
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
                    HTTP 流适合 100MB 内文件；WSS 分片保留大文件传输能力，网络中断需重试
                </div>
            )}
        </div>
    );
}

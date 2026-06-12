import type { ClipboardHistoryItem } from '../../utils/clipboard';

interface Props {
    text: string;
    onTextChange: (value: string) => void;
    onPaste: (e?: React.ClipboardEvent) => void;
    onSync: () => void;
    onCopyText: () => void;
    onTemporaryLink: () => void;
    history: string[];
    richHistory: ClipboardHistoryItem[];
    showHistory: boolean;
    onToggleHistory: () => void;
    onClearHistory: () => void;
    onSelectHistory: (content: string) => void;
}

export default function TextSharingSection({
    text, onTextChange, onPaste, onSync, onCopyText, onTemporaryLink,
    history, richHistory, showHistory, onToggleHistory, onClearHistory, onSelectHistory,
}: Props) {
    return (
        <div className="bg-gray-50/50 border border-gray-200 rounded-xl p-3.5 mb-3">
            <div className="flex items-center justify-between mb-2.5">
                <h3 className="text-[13px] font-medium text-gray-700">📝 文本共享</h3>
                <span className="text-[10px] text-gray-400">📄 文本实时同步</span>
            </div>
            <textarea
                className="w-full h-24 px-3.5 py-3 bg-white border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500 focus:bg-white transition resize-none placeholder:text-gray-400"
                placeholder="在此粘贴或输入文本，其他设备将实时同步..."
                value={text}
                onChange={e => onTextChange(e.target.value)}
                onPaste={e => onPaste(e)}
            />
            <div className="mt-2 flex flex-col gap-1">
                <span className="text-[11px] text-gray-400 text-center">📤 有文本时可点击按钮推送到其他设备剪贴板</span>
                {text && (
                    <button
                        className="w-full px-4 py-2 bg-emerald-500 text-white rounded-lg text-[13px] font-medium hover:bg-emerald-600 transition active:scale-[0.98]"
                        onClick={onSync}
                    >
                        📤 推送到其他设备
                    </button>
                )}
            </div>
            <div className="flex items-center gap-3 mt-2">
                {text && (
                    <button className="text-[11px] text-gray-400 hover:text-indigo-500 transition" onClick={onCopyText}>
                        📄 复制文本
                    </button>
                )}
                {text && (
                    <button className="text-[11px] text-gray-400 hover:text-indigo-500 transition" onClick={onTemporaryLink}>
                        🔗 临时投递
                    </button>
                )}
                {(history.length > 0 || richHistory.length > 0) && (
                    <button
                        className="text-[11px] text-gray-400 hover:text-gray-600 transition"
                        onClick={onToggleHistory}
                    >
                        📜 历史 ({richHistory.length || history.length})
                    </button>
                )}
                {(history.length > 0 || richHistory.length > 0) && (
                    <button className="text-[11px] text-gray-400 hover:text-red-500 transition" onClick={onClearHistory}>
                        清除历史
                    </button>
                )}
            </div>
            {showHistory && (history.length > 0 || richHistory.length > 0) && (
                <div className="mt-2 border border-gray-200 rounded-lg bg-white max-h-40 overflow-y-auto">
                    {(richHistory.length > 0 ? richHistory : history.map((h, i) => ({ id: String(i), type: 'text' as const, content: h, createdAt: Date.now() }))).map((h) => (
                        <button
                            key={h.id}
                            className="w-full text-left px-3 py-2 text-[12px] text-gray-700 hover:bg-gray-50 border-b border-gray-100 last:border-b-0 truncate"
                            onClick={() => {
                                if (h.type === 'text' && h.content) onSelectHistory(h.content);
                            }}
                        >
                            {h.type === 'text' ? h.content : h.type === 'file' ? `文件：${h.fileName}` : '图片记录'}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

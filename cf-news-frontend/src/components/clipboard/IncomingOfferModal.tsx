import { formatFileSize } from '../../utils/clipboard';
import type { IncomingFileOffer } from './types';

interface Props {
    offers: IncomingFileOffer[];
    autoAccept: boolean;
    trustedDevices: string[];
    autoAcceptRemaining: number;
    onAccept: (transferId: string) => void;
    onReject: (transferId: string) => void;
}

export default function IncomingOfferModal({ offers, autoAccept, trustedDevices, autoAcceptRemaining, onAccept, onReject }: Props) {
    if (offers.length === 0) return null;
    return (
        <div className="fixed inset-0 bg-black/40 z-[60] flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-5 border border-gray-200">
                <div className="flex items-center gap-2 mb-3">
                    <span className="text-2xl">📥</span>
                    <span className="text-sm font-medium text-gray-900">收到文件传输请求</span>
                </div>
                {offers.map((offer) => (
                    <div key={offer.transferId} className="bg-gray-50 rounded-lg p-3 mb-3 last:mb-0">
                        <div className="flex items-center gap-2">
                            <span className="text-[13px] text-gray-700 truncate max-w-[220px]">{offer.fileName}</span>
                        </div>
                        <div className="text-[11px] text-gray-400 mt-1">{formatFileSize(offer.fileSize)}</div>
                        <div className="text-[11px] text-gray-400 mt-1">来自 {offer.sender || '其他设备'} · {offer.transport.toUpperCase()}</div>
                        <div className="flex gap-2 mt-2.5">
                            <button 
                                className="px-3 py-1.5 bg-emerald-500 text-white rounded-lg text-[12px] font-medium hover:bg-emerald-600 transition active:scale-[0.98] flex items-center gap-1"
                                onClick={() => onAccept(offer.transferId)}
                            >
                                ✓ 接受{(autoAccept || (offer.deviceId && trustedDevices.includes(offer.deviceId))) && autoAcceptRemaining > 0 && <span className="text-[11px] opacity-80">({autoAcceptRemaining}s)</span>}
                            </button>
                            <button 
                                className="px-3 py-1.5 bg-gray-200 text-gray-600 rounded-lg text-[12px] font-medium hover:bg-gray-300 transition active:scale-[0.98]"
                                onClick={() => onReject(offer.transferId)}
                            >
                                ✕ 拒绝
                            </button>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

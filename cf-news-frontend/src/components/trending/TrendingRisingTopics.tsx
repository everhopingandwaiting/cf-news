import { SKELETON_RISE_COUNT } from './types';
import { Skeleton } from './types';
import type { TrendingWord } from './types';
import { EmptyState } from './icons';

interface TrendingRisingTopicsProps {
    risingTopics: {
        keyword: string;
        current: number;
        previous: number;
        change: number;
        pct: number;
        burst: boolean;
    }[];
    tpLoading: boolean;
    keywords: TrendingWord[];
    onSearch: (keyword: string) => void;
    onClose: () => void;
}

export default function TrendingRisingTopics({ risingTopics, tpLoading, keywords, onSearch, onClose }: TrendingRisingTopicsProps) {
    if (tpLoading) {
        return (
            <div className="space-y-2 py-4">
                {Array.from({ length: SKELETON_RISE_COUNT }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between px-3 py-2">
                        <Skeleton className="h-4 w-32" />
                        <Skeleton className="h-4 w-20" />
                    </div>
                ))}
            </div>
        );
    }

    if (risingTopics.length === 0) {
        return <EmptyState icon="trending" title="暂无足够数据计算趋势" hint="试试切换时间范围" />;
    }

    return (
        <div className="space-y-1">
            {risingTopics.map((r, i) => (
                <button key={r.keyword}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 transition cursor-pointer text-left"
                    onClick={() => { onSearch(r.keyword); onClose(); }}>
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] text-gray-400 w-5 shrink-0">{i + 1}</span>
                        <span className="text-sm text-gray-800 font-medium truncate">{r.keyword}</span>
                        <span className="flex items-center gap-0.5 shrink-0">
                            {keywords.find(k => k.word === r.keyword)?.is_new && <span className="text-[9px] bg-emerald-500 text-white px-1 rounded-full font-bold">新</span>}
                            {r.burst && <span className="text-[9px] bg-red-500 text-white px-1 rounded-full font-bold">爆</span>}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-gray-500">{r.previous} → {r.current}</span>
                        <span className={`text-xs font-semibold ${r.change > 0 ? 'text-red-500' : r.change < 0 ? 'text-green-500' : 'text-gray-400'}`}>
                            {r.change > 0 ? '↑' : r.change < 0 ? '↓' : '→'} {Math.abs(r.pct)}%
                        </span>
                    </div>
                </button>
            ))}
        </div>
    );
}

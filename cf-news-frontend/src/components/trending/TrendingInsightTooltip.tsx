import { displayWord } from './types';

interface TrendingInsightTooltipProps {
    insight: { keyword: string; text: string; loading: boolean } | null;
    setInsight: (v: { keyword: string; text: string; loading: boolean } | null) => void;
}

export default function TrendingInsightTooltip({ insight, setInsight }: TrendingInsightTooltipProps) {
    if (!insight) return null;

    return (
        <div className="absolute bottom-4 left-4 right-4 z-20">
            <div className="bg-white rounded-xl shadow-lg border border-gray-200 p-4 animate-slideUp">
                <div className="flex items-start justify-between gap-2">
                    <div className="text-[13px] font-semibold text-gray-800">{displayWord(insight.keyword)}</div>
                    <button className="text-gray-400 hover:text-gray-600 cursor-pointer text-sm leading-none"
                        onClick={() => setInsight(null)}>&times;</button>
                </div>
                <div className="mt-1.5 text-[12px] text-gray-600 leading-relaxed">
                    {insight.loading ? (
                        <div className="flex items-center gap-2">
                            <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                            分析中...
                        </div>
                    ) : insight.text}
                </div>
            </div>
        </div>
    );
}

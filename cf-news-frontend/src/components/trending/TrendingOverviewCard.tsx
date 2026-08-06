/* ─── AI 趋势总览卡片（渐变横幅风格，与 Home banner 一致） ─── */
import { useState } from 'react';
import { Icon } from './icons';
import type { TrendingOverview } from './types';
import { displayWord, isBigram } from './types';

export default function TrendingOverviewCard({ overview, loading, onRefresh, onKeywordClick }: {
    overview: TrendingOverview | null;
    loading: boolean;
    onRefresh: () => void;
    onKeywordClick: (word: string) => void;
}) {
    const [refreshing, setRefreshing] = useState(false);

    const handleRefresh = async () => {
        if (refreshing) return;
        setRefreshing(true);
        try { await onRefresh(); } finally { setRefreshing(false); }
    };

    const text = overview?.overview || '';
    const keywords = overview?.keywords || [];
    const hasOverview = text.length > 0;
    const hasKeywords = keywords.length > 0;

    // 无总览也无关键词时整卡隐藏
    if (!loading && !hasOverview && !hasKeywords) return null;

    return (
        <div className="rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 p-4 text-white shadow-md mb-4">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                    <Icon name="sparkle" className="w-4 h-4" />
                    <span className="text-[13px] font-semibold tracking-wide">AI 趋势总览</span>
                </div>
                <div className="flex items-center gap-2">
                    {overview?.generated_at && (
                        <span className="text-[10px] text-white/70">
                            {new Date(overview.generated_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    )}
                    <button
                        className="p-1 rounded-full bg-white/15 hover:bg-white/25 transition cursor-pointer disabled:opacity-50"
                        onClick={handleRefresh}
                        disabled={refreshing}
                        aria-label="刷新总览"
                        title="刷新总览"
                    >
                        <Icon name="refresh" className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {loading ? (
                <div className="mt-3 space-y-2">
                    <div className="h-3 bg-white/30 rounded animate-pulse w-full" />
                    <div className="h-3 bg-white/30 rounded animate-pulse w-11/12" />
                    <div className="h-3 bg-white/30 rounded animate-pulse w-4/5" />
                </div>
            ) : hasOverview ? (
                <p className="mt-3 text-[12.5px] leading-relaxed text-white/95">{text}</p>
            ) : null}

            {!loading && !hasOverview && hasKeywords && (
                <p className="mt-3 text-[11.5px] text-white/80">本次未生成总览，热门关键词如下：</p>
            )}

            {!loading && hasKeywords && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                    {keywords.slice(0, 10).map(kw => {
                        const word = displayWord(kw.word);
                        return (
                            <button
                                key={kw.word}
                                className={`px-2.5 py-1 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-sm text-[12px] font-medium transition cursor-pointer ${isBigram(kw.word) ? 'font-semibold' : ''}`}
                                onClick={() => onKeywordClick(kw.word)}
                                title={`查看「${word}」`}
                            >
                                {word}
                                <span className="ml-1 text-[10px] text-white/70">{kw.count}</span>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

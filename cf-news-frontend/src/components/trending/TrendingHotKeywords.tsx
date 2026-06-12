import type { NewsItem } from '../../types';
import { PALETTE, SKELETON_CLASSES, MAX_KEYWORD_SOURCES, MAX_DROPPED_DISPLAY } from './types';
import { isBigram, displayWord, Skeleton } from './types';
import type { TrendingWord, CompareSeries } from './types';
import TrendingCompareChart from '../TrendingCompareChart';

interface TrendingHotKeywordsProps {
    keywords: TrendingWord[];
    kwLoading: boolean;
    error: string | null;
    maxWordCount: number;
    kwArticles: { keyword: string; items: NewsItem[]; loading: boolean } | null;
    setKwArticles: (v: { keyword: string; items: NewsItem[]; loading: boolean } | null) => void;
    dropped: string[];
    fetchKeywordArticles: (keyword: string) => void;
    fetchInsight: (keyword: string) => void;
    onSearch: (keyword: string) => void;
    onSelectArticle?: (item: NewsItem) => void;
    onClose: () => void;
    compareKws: string[];
    toggleCompareKw: (kw: string) => void;
    compareSeries: CompareSeries[];
    compareLoading: boolean;
}

export default function TrendingHotKeywords({
    keywords, kwLoading, error, maxWordCount, kwArticles, setKwArticles, dropped,
    fetchKeywordArticles, fetchInsight, onSearch, onSelectArticle, onClose,
    compareKws, toggleCompareKw, compareSeries, compareLoading,
}: TrendingHotKeywordsProps) {
    return (
        <>
            {kwLoading ? (
                <div className="flex flex-wrap gap-2.5 justify-center py-4">
                    {SKELETON_CLASSES.map((cls, i) => (
                        <Skeleton key={i} className={`${cls} rounded-xl`} />
                    ))}
                </div>
            ) : keywords.length === 0 ? (
                <div className="text-center py-12 text-gray-400 text-sm">{error || '暂无数据'}</div>
            ) : (
                <div className="flex flex-wrap gap-2.5 justify-center py-2">
                    {keywords.map((kw, i) => {
                        const ratio = kw.count / maxWordCount;
                        const color = PALETTE[i % PALETTE.length];
                        const size = ratio > 0.8 ? 'text-base font-bold' : ratio > 0.6 ? 'text-sm font-semibold' : ratio > 0.4 ? 'text-xs font-medium' : 'text-[11px]';
                        const rotate = i % 5 === 0 ? 'rotate-[-1.5deg]' : i % 7 === 0 ? 'rotate-[1.5deg]' : '';
                        const pad = ratio > 0.6 ? 'px-3.5 py-2' : 'px-3 py-1.5';
                        return (
                            <div key={kw.word} className="flex flex-col items-center">
                                <button
                                    className={`${color} ${size} ${pad} ${rotate} rounded-xl border transition-all duration-200 cursor-pointer hover:scale-105 hover:shadow-sm active:scale-95 relative`}
                                    onClick={() => fetchKeywordArticles(kw.word)}
                                    title={`${displayWord(kw.word)} (${kw.count}) - 点击查看相关文章`}>
                                    {isBigram(kw.word) && <span className="text-[9px] opacity-50 font-normal mr-0.5">词组</span>}
                                    {displayWord(kw.word)}
                                    {kw.is_new && <span className="absolute -top-2 -left-2 text-[10px] bg-emerald-500 text-white px-1 rounded-full font-bold animate-bounce">新</span>}
                                    {kw.burst && <span className="absolute -top-2 -right-2 text-[9px] bg-red-500 text-white px-1 rounded-full font-bold">爆</span>}
                                    {kw.change_pct !== undefined && kw.change_pct !== 0 && (
                                        <span className={`text-[10px] ml-1 font-semibold ${kw.change_pct > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                            {kw.change_pct > 0 ? '↑' : '↓'}{Math.abs(kw.change_pct)}%
                                        </span>
                                    )}
                                </button>
                                <div className="flex items-center gap-1 mt-0.5">
                                    {kw.sources && kw.sources.length > 0 && (
                                        <span className="text-[9px] text-gray-400 truncate max-w-[80px]">
                                            {kw.sources.slice(0, MAX_KEYWORD_SOURCES).map(s => s.name).join('/')}
                                        </span>
                                    )}
                                    <button
                                        className="text-[10px] text-gray-400 hover:text-gray-600 cursor-pointer leading-none"
                                        onClick={(e) => { e.stopPropagation(); onSearch(kw.word); onClose(); }}
                                        title="搜索此关键词">
                                        搜
                                    </button>
                                    <button
                                        className="text-[10px] text-indigo-400 hover:text-indigo-600 cursor-pointer leading-none"
                                        onClick={(e) => { e.stopPropagation(); fetchInsight(kw.word); }}
                                        title="AI 解读">
                                        AI
                                    </button>
                                    <button
                                        className={`text-[10px] cursor-pointer leading-none ${compareKws.includes(kw.word) ? 'text-indigo-500 font-bold' : 'text-gray-300 hover:text-gray-500'}`}
                                        onClick={(e) => { e.stopPropagation(); toggleCompareKw(kw.word); }}
                                        title={compareKws.includes(kw.word) ? '取消对比' : '加入对比'}>
                                        {compareKws.includes(kw.word) ? '对比✓' : '对比'}
                                    </button>
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {compareSeries.length >= 2 && (
                <div className="mt-4"><TrendingCompareChart series={compareSeries} loading={compareLoading} /></div>
            )}

            {kwArticles && (
                <div className="mt-4 pt-3 border-t border-gray-100">
                    <div className="flex items-center justify-between mb-2">
                        <div className="text-[12px] text-gray-500 font-medium">"{displayWord(kwArticles.keyword)}" 相关文章</div>
                        <button className="text-[11px] text-gray-400 hover:text-gray-600 cursor-pointer"
                            onClick={() => setKwArticles(null)}>关闭</button>
                    </div>
                    {kwArticles.loading ? (
                        <div className="flex items-center justify-center gap-2 py-4">
                            <span className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                            <span className="text-[12px] text-gray-400">搜索中...</span>
                        </div>
                    ) : kwArticles.items.length === 0 ? (
                        <div className="text-center py-4 text-gray-400 text-[12px]">没有找到相关文章</div>
                    ) : (
                        <div className="space-y-1.5 max-h-64 overflow-y-auto">
                            {kwArticles.items.map((item) => (
                                <div key={item.id}
                                    className="flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 cursor-pointer transition"
                                    onClick={() => { if (onSelectArticle) { onSelectArticle(item); onClose(); } }}>
                                    {item.image_url && (
                                        <img src={item.image_url} alt="" className="w-8 h-8 rounded object-cover mt-0.5 shrink-0"
                                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <div className="text-[12px] text-gray-800 font-medium leading-tight line-clamp-2">{item.title}</div>
                                        <div className="flex items-center gap-2 mt-0.5">
                                            <span className="text-[10px] text-gray-400">{item.source_name}</span>
                                            {item.published_at && (
                                                <span className="text-[10px] text-gray-400">{item.published_at.substring(11, 16)}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {dropped.length > 0 && (
                <div className="mt-4 pt-3 border-t border-gray-100">
                    <div className="text-[11px] text-gray-400 mb-2 font-medium">已回落热词</div>
                    <div className="flex flex-wrap gap-1.5">
                        {dropped.slice(0, MAX_DROPPED_DISPLAY).map((w, i) => (
                            <span key={w} className={`text-[11px] px-2 py-0.5 bg-gray-100 text-gray-500 rounded-full ${i < 3 ? 'line-through decoration-gray-300' : ''}`}>
                                {displayWord(w)}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}

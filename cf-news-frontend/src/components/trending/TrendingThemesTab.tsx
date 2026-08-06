import { useState } from 'react';
import type { NewsItem } from '../../types';
import { displayWord, Skeleton } from './types';
import type { TrendTheme, ThemePerspective } from './types';
import { Icon, EmptyState } from './icons';

interface TrendingThemesTabProps {
    themes: TrendTheme[];
    themeLoading: boolean;
    fetchKeywordArticles: (keyword: string) => void;
    fetchInsight: (keyword: string) => void;
    perspective: { keyword: string; data: ThemePerspective | null; loading: boolean } | null;
    fetchPerspective: (keyword: string) => void;
    onSearch: (keyword: string) => void;
    onSelectArticle?: (item: NewsItem) => void;
    onClose: () => void;
}

export default function TrendingThemesTab({ themes, themeLoading, fetchKeywordArticles, fetchInsight, perspective, fetchPerspective, onSearch, onSelectArticle, onClose }: TrendingThemesTabProps) {
    const [openTheme, setOpenTheme] = useState<string | null>(null);

    function handlePerspective(label: string) {
        if (openTheme === label) { setOpenTheme(null); return; }
        setOpenTheme(label);
        fetchPerspective(label);
    }

    if (themeLoading) {
        return (
            <div className="space-y-3 py-3">
                {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="border border-gray-200 rounded-lg p-3">
                        <Skeleton className="h-5 w-40 mb-3" />
                        <Skeleton className="h-4 w-full mb-2" />
                        <Skeleton className="h-4 w-3/4" />
                    </div>
                ))}
            </div>
        );
    }

    if (themes.length === 0) {
        return <EmptyState icon="tag" title="暂无趋势主题" hint="试试切换时间范围" />;
    }

    const showPanel = (label: string) => openTheme === label && perspective?.keyword === label;

    return (
        <div className="space-y-3">
            {themes.map((theme, index) => (
                <div key={theme.label} className="border border-gray-200 rounded-lg p-3.5 bg-white hover:border-indigo-200 hover:shadow-sm transition">
                    <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                            <div className="flex items-center gap-2">
                                <span className="text-[11px] text-gray-400 w-5">{index + 1}</span>
                                <h3 className="text-sm font-semibold text-gray-900 truncate">{displayWord(theme.label)}</h3>
                            </div>
                            <div className="mt-1 flex flex-wrap gap-1.5">
                                {theme.keywords.map(keyword => (
                                    <button key={keyword} className="px-2 py-0.5 rounded-full bg-gray-100 text-[11px] text-gray-600 hover:bg-indigo-50 hover:text-indigo-600"
                                        onClick={() => fetchKeywordArticles(keyword)}>
                                        {displayWord(keyword)}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="shrink-0 text-right">
                            <div className={`text-[12px] font-semibold ${theme.status === 'rising' ? 'text-red-500' : theme.status === 'falling' ? 'text-emerald-600' : 'text-gray-500'}`}>
                                {theme.status === 'rising' ? '上升' : theme.status === 'falling' ? '回落' : '平稳'} {theme.change_pct > 0 ? '+' : ''}{theme.change_pct}%
                            </div>
                            <div className="text-[10px] text-gray-400">{theme.total} 热度</div>
                        </div>
                    </div>
                    {theme.articles.length > 0 && (
                        <div className="mt-3 space-y-1.5">
                            {theme.articles.slice(0, 3).map(article => (
                                <button key={article.id}
                                    className="w-full text-left px-2.5 py-2 rounded-lg bg-gray-50 hover:bg-indigo-50 transition"
                                    onClick={() => { if (onSelectArticle) { onSelectArticle(article); onClose(); } }}>
                                    <div className="text-[12px] font-medium text-gray-800 line-clamp-2">{article.title}</div>
                                    <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-400">
                                        <span>{article.source_name || '未知来源'}</span>
                                        {article.category && <span>{article.category}</span>}
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="mt-3 flex gap-2">
                        <button className="px-2.5 py-1.5 rounded-lg bg-indigo-500 text-white text-[12px] hover:bg-indigo-600"
                            onClick={() => { onSearch(theme.label); onClose(); }}>
                            搜索主题
                        </button>
                        <button className="px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 text-[12px] hover:bg-gray-200"
                            onClick={() => fetchInsight(theme.label)}>
                            AI 解读
                        </button>
                        <button className={`px-2.5 py-1.5 rounded-lg text-[12px] transition flex items-center gap-1 ${openTheme === theme.label ? 'bg-violet-500 text-white' : 'bg-violet-50 text-violet-600 hover:bg-violet-100'}`}
                            onClick={() => handlePerspective(theme.label)}
                            title="AI 多视角分析">
                            <Icon name="eye" className="w-3.5 h-3.5" />
                            多视角
                            <Icon name="chevron" className={`w-3 h-3 transition-transform ${openTheme === theme.label ? 'rotate-180' : ''}`} />
                        </button>
                    </div>
                    {showPanel(theme.label) && (
                        <div className="mt-3 pt-3 border-t border-gray-100 animate-slideUp">
                            {perspective!.loading ? (
                                <div className="flex items-center justify-center gap-2 py-4">
                                    <span className="w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin" />
                                    <span className="text-[12px] text-gray-400">AI 分析中...</span>
                                </div>
                            ) : perspective!.data ? (
                                <>
                                    <div className="flex items-center gap-1.5 text-[12px] font-semibold text-violet-600 mb-2">
                                        <Icon name="eye" className="w-3.5 h-3.5" />
                                        多视角分析
                                        {perspective!.data.generated_at && (
                                            <span className="text-[10px] font-normal text-gray-400 ml-auto">
                                                {new Date(perspective!.data.generated_at).toLocaleString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                            </span>
                                        )}
                                    </div>
                                    <p className="text-[12px] leading-relaxed text-gray-700">{perspective!.data.perspective}</p>
                                    {perspective!.data.related.length > 0 && (
                                        <div className="mt-2.5 space-y-1">
                                            {perspective!.data.related.map(r => (
                                                <button key={r.id}
                                                    className="w-full text-left px-2.5 py-1.5 rounded-lg bg-violet-50/60 hover:bg-violet-100 transition flex items-start gap-2"
                                                    onClick={() => { if (onSelectArticle) { onSelectArticle({ id: r.id, source_id: 0, title: r.title, url: '', category: '', created_at: new Date().toISOString(), source_name: r.source }); onClose(); } }}>
                                                    <Icon name="document" className="w-3.5 h-3.5 mt-0.5 text-violet-400" />
                                                    <span className="min-w-0">
                                                        <span className="block text-[12px] text-gray-800 font-medium leading-tight line-clamp-2">{r.title}</span>
                                                        {r.source && <span className="text-[10px] text-gray-400">{r.source}</span>}
                                                    </span>
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="flex items-center justify-center gap-2 py-4 text-gray-400 text-[12px]">
                                    <Icon name="close" className="w-3.5 h-3.5" />
                                    暂无多视角分析
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
}

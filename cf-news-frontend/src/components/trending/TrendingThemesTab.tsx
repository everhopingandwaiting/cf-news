import type { NewsItem } from '../../types';
import { displayWord, Skeleton } from './types';
import type { TrendTheme } from './types';

interface TrendingThemesTabProps {
    themes: TrendTheme[];
    themeLoading: boolean;
    fetchKeywordArticles: (keyword: string) => void;
    fetchInsight: (keyword: string) => void;
    onSearch: (keyword: string) => void;
    onSelectArticle?: (item: NewsItem) => void;
    onClose: () => void;
}

export default function TrendingThemesTab({ themes, themeLoading, fetchKeywordArticles, fetchInsight, onSearch, onSelectArticle, onClose }: TrendingThemesTabProps) {
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
        return <div className="text-center py-12 text-gray-400 text-sm">暂无趋势主题</div>;
    }

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
                    </div>
                </div>
            ))}
        </div>
    );
}

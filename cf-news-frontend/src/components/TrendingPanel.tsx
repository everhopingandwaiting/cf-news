import { useState, useEffect } from 'react';
import type { NewsItem } from '../types';
import type { TrendingWord, Topic, CategoryInfo, CompareSeries, HourlySource, HourlyCat, TrendTheme } from './trending/types';
import { KEYWORD_ARTICLES_LIMIT } from './trending/types';
import PeriodSelector from './trending/PeriodSelector';
import TrendingThemesTab from './trending/TrendingThemesTab';
import TrendingHotKeywords from './trending/TrendingHotKeywords';
import TrendingRisingTopics from './trending/TrendingRisingTopics';
import TrendingChartTab from './trending/TrendingChartTab';
import TrendingInsightTooltip from './trending/TrendingInsightTooltip';
import TrendingHourlyChart from './TrendingHourlyChart';

export default function TrendingPanel({ visible, onClose, onSearch, onSelectArticle }: { visible: boolean; onClose: () => void; onSearch: (keyword: string) => void; onSelectArticle?: (item: NewsItem) => void }) {
    const [tab, setTab] = useState<'themes' | 'hot' | 'rise' | 'chart' | 'sources' | 'cats'>('themes');
    const [period, setPeriod] = useState(24);
    const [keywords, setKeywords] = useState<TrendingWord[]>([]);
    const [topics, setTopics] = useState<Topic[]>([]);
    const [activeTopic, setActiveTopic] = useState<string | null>(null);
    const [kwLoading, setKwLoading] = useState(true);
    const [tpLoading, setTpLoading] = useState(true);
    const [dropped, setDropped] = useState<string[]>([]);
    const [activity, setActivity] = useState<{ hour: string; count: number }[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [kwArticles, setKwArticles] = useState<{ keyword: string; items: NewsItem[]; loading: boolean } | null>(null);
    const [categories, setCategories] = useState<CategoryInfo[]>([]);
    const [catLoading, setCatLoading] = useState(false);
    const [compareKws, setCompareKws] = useState<string[]>([]);
    const [compareSeries, setCompareSeries] = useState<CompareSeries[]>([]);
    const [compareLoading, setCompareLoading] = useState(false);
    const [insight, setInsight] = useState<{ keyword: string; text: string; loading: boolean } | null>(null);
    const [hourlySrc, setHourlySrc] = useState<HourlySource[]>([]);
    const [hourlyCat, setHourlyCat] = useState<HourlyCat[]>([]);
    const [hourlyLoading, setHourlyLoading] = useState(false);
    const [kwFetchController, setKwFetchController] = useState<AbortController | null>(null);
    const [themes, setThemes] = useState<TrendTheme[]>([]);
    const [themeLoading, setThemeLoading] = useState(false);

    useEffect(() => {
        if (!visible) return;
        setError(null);
        setKwLoading(true);
        setTpLoading(true);
        setCatLoading(true);
        setThemeLoading(true);
        setKwArticles(null);

        fetch(`/api/news/trending/themes?hours=${period}`)
            .then(r => r.json())
            .then(data => { if (data.themes) setThemes(data.themes); })
            .catch(() => {})
            .finally(() => setThemeLoading(false));

        fetch(`/api/news/trending?hours=${period}`)
            .then(r => r.json())
            .then(data => { if (data.trending) setKeywords(data.trending); if (data.dropped) setDropped(data.dropped); })
            .catch(() => setError('加载趋势数据失败'))
            .finally(() => setKwLoading(false));

        fetch(`/api/news/trending/topics?hours=${period}`)
            .then(r => r.json())
            .then(data => { if (data.topics) setTopics(data.topics); })
            .catch(() => {})
            .finally(() => setTpLoading(false));

        fetch(`/api/news/trending/categories?hours=${period}`)
            .then(r => r.json())
            .then(data => { if (data.categories) setCategories(data.categories); })
            .catch(() => {})
            .finally(() => setCatLoading(false));

        setHourlyLoading(true);
        fetch(`/api/news/trending/hourly?hours=${period}`)
            .then(r => r.json())
            .then(data => {
                if (data.sources) setHourlySrc(data.sources);
                if (data.categories) setHourlyCat(data.categories);
            })
            .catch(() => {})
            .finally(() => setHourlyLoading(false));
    }, [visible, period]);

    useEffect(() => {
        if (topics.length === 0) return;
        const hourTotals: Record<string, number> = {};
        for (const t of topics) {
            for (const p of t.points) {
                hourTotals[p.date_hour] = (hourTotals[p.date_hour] || 0) + p.count;
            }
        }
        setActivity(
            Object.entries(hourTotals)
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([hour, count]) => ({ hour, count }))
        );
    }, [topics]);

    useEffect(() => {
        if (compareKws.length < 2) { setCompareSeries([]); return; }
        setCompareLoading(true);
        fetch(`/api/news/trending/compare?keywords=${compareKws.join(',')}&hours=${period}`)
            .then(r => r.json())
            .then(data => { if (data.series) setCompareSeries(data.series); })
            .catch(() => {})
            .finally(() => setCompareLoading(false));
    }, [compareKws, period]);

    if (!visible) return null;

    const maxWordCount = Math.max(...keywords.map(k => k.count), 1);

    const risingTopics = topics
        .map(t => {
            const sortedPts = [...t.points].sort((a, b) => a.date_hour.localeCompare(b.date_hour));
            if (sortedPts.length < 2) return null;
            const last = sortedPts[sortedPts.length - 1].count;
            const prev = sortedPts[sortedPts.length - 2].count;
            const change = last - prev;
            const pct = prev > 0 ? Math.round((change / prev) * 100) : (change > 0 ? 100 : 0);
            const found = keywords.find(k => k.word === t.keyword);
            return { keyword: t.keyword, current: last, previous: prev, change, pct, burst: found?.burst || false };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 20);

    function toggleCompareKw(kw: string) {
        setCompareKws(prev =>
            prev.includes(kw) ? prev.filter(k => k !== kw) : [...prev, kw]
        );
    }

    function fetchKeywordArticles(keyword: string) {
        if (kwArticles?.keyword === keyword && !kwArticles.loading) return;
        if (kwFetchController) kwFetchController.abort();
        const controller = new AbortController();
        setKwFetchController(controller);
        setKwArticles({ keyword, items: [], loading: true });
        fetch(`/api/news?search=${encodeURIComponent(keyword)}&limit=${KEYWORD_ARTICLES_LIMIT}`, { signal: controller.signal })
            .then(r => r.json())
            .then(data => { if (!controller.signal.aborted) setKwArticles({ keyword, items: data.news || [], loading: false }); })
            .catch(() => { if (!controller.signal.aborted) setKwArticles({ keyword, items: [], loading: false }); });
    }

    function fetchInsight(keyword: string) {
        if (insight?.keyword === keyword && !insight.loading) return;
        setInsight({ keyword, text: '', loading: true });
        fetch('/api/ai/trending/insight', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword, hours: period }),
        })
            .then(r => r.json())
            .then(data => setInsight({ keyword, text: data.insight || data.error || '无法生成分析', loading: false }))
            .catch(() => setInsight({ keyword, text: '分析失败', loading: false }));
    }

    const handlePeriodChange = (p: number) => { setPeriod(p); setCompareKws([]); };

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/30 animate-fadeIn" onClick={onClose} />
            <div className="relative w-full max-w-lg bg-white shadow-2xl h-full overflow-y-auto animate-slideIn">
                <div className="sticky top-0 bg-white/95 backdrop-blur-sm z-10 border-b border-gray-200">
                    <div className="flex items-center justify-between px-5 py-3">
                        <div className="flex gap-1.5 overflow-x-auto scrollbar-none flex-nowrap">
                            <button className={`shrink-0 px-3 py-1.5 rounded-lg text-[13px] font-medium transition cursor-pointer ${tab === 'themes' ? 'bg-indigo-500 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100'}`} onClick={() => setTab('themes')} aria-label="趋势主题">主题</button>
                            <button className={`shrink-0 px-3 py-1.5 rounded-lg text-[13px] font-medium transition cursor-pointer ${tab === 'hot' ? 'bg-indigo-500 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100'}`} onClick={() => setTab('hot')} aria-label="热门关键词">热词</button>
                            <button className={`shrink-0 px-3 py-1.5 rounded-lg text-[13px] font-medium transition cursor-pointer ${tab === 'rise' ? 'bg-indigo-500 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100'}`} onClick={() => setTab('rise')} aria-label="上升趋势">上升</button>
                            <button className={`shrink-0 px-3 py-1.5 rounded-lg text-[13px] font-medium transition cursor-pointer ${tab === 'chart' ? 'bg-indigo-500 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100'}`} onClick={() => setTab('chart')} aria-label="关键词对比">对比</button>
                            <button className={`shrink-0 px-3 py-1.5 rounded-lg text-[13px] font-medium transition cursor-pointer ${tab === 'sources' ? 'bg-indigo-500 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100'}`} onClick={() => setTab('sources')} aria-label="来源分布">来源</button>
                            <button className={`shrink-0 px-3 py-1.5 rounded-lg text-[13px] font-medium transition cursor-pointer ${tab === 'cats' ? 'bg-indigo-500 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100'}`} onClick={() => setTab('cats')} aria-label="分类分布">分类</button>
                        </div>
                        <button className="shrink-0 ml-2 text-gray-400 hover:text-gray-700 text-xl leading-none cursor-pointer" onClick={onClose} aria-label="关闭面板">&times;</button>
                    </div>
                </div>

                <PeriodSelector period={period} onChange={handlePeriodChange} />

                <div className="p-4 pt-2">
                    {error && (
                        <div className="mx-4 mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
                            <span className="text-[12px] text-red-600">{error}</span>
                            <button className="text-[12px] text-red-500 font-medium cursor-pointer hover:text-red-700" onClick={() => window.location.reload()}>重试</button>
                        </div>
                    )}

                    {tab === 'themes' && <TrendingThemesTab themes={themes} themeLoading={themeLoading} fetchKeywordArticles={fetchKeywordArticles} fetchInsight={fetchInsight} onSearch={onSearch} onSelectArticle={onSelectArticle} onClose={onClose} />}

                    {tab === 'hot' && <TrendingHotKeywords keywords={keywords} kwLoading={kwLoading} error={error} maxWordCount={maxWordCount} kwArticles={kwArticles} setKwArticles={setKwArticles} dropped={dropped} fetchKeywordArticles={fetchKeywordArticles} fetchInsight={fetchInsight} onSearch={onSearch} onSelectArticle={onSelectArticle} onClose={onClose} compareKws={compareKws} toggleCompareKw={toggleCompareKw} compareSeries={compareSeries} compareLoading={compareLoading} />}

                    {tab === 'rise' && <TrendingRisingTopics risingTopics={risingTopics} tpLoading={tpLoading} keywords={keywords} onSearch={onSearch} onClose={onClose} />}

                    {tab === 'chart' && <TrendingChartTab tpLoading={tpLoading} topics={topics} activeTopic={activeTopic} setActiveTopic={setActiveTopic} categories={categories} catLoading={catLoading} keywords={keywords} compareKws={compareKws} setCompareKws={setCompareKws} compareSeries={compareSeries} compareLoading={compareLoading} activity={activity} />}

                    {tab === 'sources' && <TrendingHourlyChart mode="sources" sources={hourlySrc} categories={hourlyCat} loading={hourlyLoading} />}
                    {tab === 'cats' && <TrendingHourlyChart mode="cats" sources={hourlySrc} categories={hourlyCat} loading={hourlyLoading} />}
                </div>

                <TrendingInsightTooltip insight={insight} setInsight={setInsight} />
            </div>
        </div>
    );
}

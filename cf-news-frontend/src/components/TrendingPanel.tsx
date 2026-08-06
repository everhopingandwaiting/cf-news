import { useState, useEffect } from 'react';
import type { NewsItem } from '../types';
import type { TrendingWord, Topic, CategoryInfo, CompareSeries, HourlySource, HourlyCat, TrendTheme, TrendingOverview, ThemePerspective } from './trending/types';
import { KEYWORD_ARTICLES_LIMIT, MAX_COMPARE_KWS } from './trending/types';
import PeriodSelector from './trending/PeriodSelector';
import TrendingThemesTab from './trending/TrendingThemesTab';
import TrendingHotKeywords from './trending/TrendingHotKeywords';
import TrendingRisingTopics from './trending/TrendingRisingTopics';
import TrendingChartTab from './trending/TrendingChartTab';
import TrendingInsightTooltip from './trending/TrendingInsightTooltip';
import TrendingOverviewCard from './trending/TrendingOverviewCard';
import { Icon } from './trending/icons';
import type { IconName } from './trending/icons';
import TrendingHourlyChart from './TrendingHourlyChart';

type TabKey = 'themes' | 'hot' | 'rise' | 'chart' | 'sources' | 'cats';

const TABS: { key: TabKey; label: string; icon: IconName; aria: string }[] = [
    { key: 'themes', label: '主题', icon: 'tag', aria: '趋势主题' },
    { key: 'hot', label: '热词', icon: 'fire', aria: '热门关键词' },
    { key: 'rise', label: '上升', icon: 'trending', aria: '上升趋势' },
    { key: 'chart', label: '对比', icon: 'chart', aria: '关键词对比' },
    { key: 'sources', label: '来源', icon: 'newspaper', aria: '来源分布' },
    { key: 'cats', label: '分类', icon: 'grid', aria: '分类分布' },
];

export default function TrendingPanel({ visible, onClose, onSearch, onSelectArticle }: { visible: boolean; onClose: () => void; onSearch: (keyword: string) => void; onSelectArticle?: (item: NewsItem) => void }) {
    const [tab, setTab] = useState<TabKey>('themes');
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
    const [radarRanks, setRadarRanks] = useState<{ rank: number; service: string }[]>([]);
    const [overview, setOverview] = useState<TrendingOverview | null>(null);
    const [overviewLoading, setOverviewLoading] = useState(true);
    const [perspective, setPerspective] = useState<{ keyword: string; data: ThemePerspective | null; loading: boolean } | null>(null);

    useEffect(() => {
        if (!visible) return;
        setError(null);
        setKwLoading(true);
        setTpLoading(true);
        setCatLoading(true);
        setThemeLoading(true);
        setKwArticles(null);

        fetch(`/api/news/trending/radar`)
            .then(r => r.json())
            .then(data => { if (data.ranks) setRadarRanks(data.ranks); })
            .catch(() => {});

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

        setOverviewLoading(true);
        fetch(`/api/news/trending/overview?hours=${period}`)
            .then(r => r.json())
            .then(data => {
                if (data.overview !== undefined || data.keywords !== undefined) {
                    setOverview({ overview: data.overview ?? null, keywords: data.keywords ?? [], generated_at: data.generated_at || '' });
                }
            })
            .catch(() => {})
            .finally(() => setOverviewLoading(false));
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

    // 热词 → 对比联动：不在对比页时跳转过去并加入关键词（最多 4 个，超出丢最旧）
    function handleCompareKeyword(kw: string) {
        if (tab !== 'chart') {
            setTab('chart');
            setCompareKws(prev => {
                if (prev.includes(kw)) return prev;
                return prev.length >= MAX_COMPARE_KWS ? [...prev.slice(1), kw] : [...prev, kw];
            });
        } else {
            toggleCompareKw(kw);
        }
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

    // 主题多视角分析（按关键词缓存，切换主题时重新拉取）
    function fetchPerspective(keyword: string) {
        if (perspective?.keyword === keyword && !perspective.loading) return;
        setPerspective({ keyword, data: null, loading: true });
        fetch(`/api/news/trending/theme-perspectives?keyword=${encodeURIComponent(keyword)}&hours=${period}`)
            .then(r => r.json())
            .then(data => {
                if (data.perspective) {
                    setPerspective({ keyword, data: { keyword, perspective: data.perspective, related: data.related || [], generated_at: data.generated_at || '' }, loading: false });
                } else {
                    setPerspective({ keyword, data: null, loading: false });
                }
            })
            .catch(() => setPerspective({ keyword, data: null, loading: false }));
    }

    async function refreshOverview() {
        setOverviewLoading(true);
        try {
            const res = await fetch(`/api/news/trending/overview?hours=${period}`);
            const data = await res.json();
            if (data.overview !== undefined || data.keywords !== undefined) {
                setOverview({ overview: data.overview ?? null, keywords: data.keywords ?? [], generated_at: data.generated_at || '' });
            }
        } catch { /* 刷新失败保留旧数据 */ }
        finally { setOverviewLoading(false); }
    }

    const handlePeriodChange = (p: number) => { setPeriod(p); setCompareKws([]); };

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/30 animate-fadeIn" onClick={onClose} />
            <div className="relative w-full max-w-lg bg-white shadow-2xl h-full overflow-y-auto animate-slideIn">
                <div className="sticky top-0 bg-white/95 backdrop-blur-sm z-10 border-b border-gray-200">
                    <div className="flex items-center justify-between px-5 py-3">
                        <div className="flex gap-1.5 overflow-x-auto scrollbar-none flex-nowrap">
                            {TABS.map(t => (
                                <button key={t.key} className={`shrink-0 px-3 py-1.5 rounded-lg text-[13px] font-medium transition cursor-pointer flex items-center gap-1 ${tab === t.key ? 'bg-indigo-500 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100'}`} onClick={() => setTab(t.key)} aria-label={t.aria}>
                                    <Icon name={t.icon} className="w-3.5 h-3.5" />
                                    {t.label}
                                </button>
                            ))}
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

                    <TrendingOverviewCard
                        overview={overview}
                        loading={overviewLoading}
                        onRefresh={refreshOverview}
                        onKeywordClick={handleCompareKeyword}
                    />

                    {radarRanks.length > 0 && (
                        <div className="rounded-lg border border-gray-200 bg-white p-3 mb-3">
                            <div className="flex items-center gap-1.5 mb-2">
                                <Icon name="trending" className="w-3.5 h-3.5 text-gray-400" />
                                <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">全球服务排行 · Cloudflare Radar</span>
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {radarRanks.slice(0, 10).map(r => (
                                    <span key={r.service} className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] ${r.rank <= 3 ? 'bg-indigo-50 text-indigo-600 font-semibold' : 'bg-gray-50 text-gray-500'}`}>
                                        <span className="text-[10px] opacity-70">#{r.rank}</span>{r.service}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {tab === 'themes' && <TrendingThemesTab themes={themes} themeLoading={themeLoading} fetchKeywordArticles={fetchKeywordArticles} fetchInsight={fetchInsight} perspective={perspective} fetchPerspective={fetchPerspective} onSearch={onSearch} onSelectArticle={onSelectArticle} onClose={onClose} />}

                    {tab === 'hot' && <TrendingHotKeywords keywords={keywords} kwLoading={kwLoading} error={error} maxWordCount={maxWordCount} topics={topics} kwArticles={kwArticles} setKwArticles={setKwArticles} dropped={dropped} fetchKeywordArticles={fetchKeywordArticles} fetchInsight={fetchInsight} handleCompareKeyword={handleCompareKeyword} onSearch={onSearch} onSelectArticle={onSelectArticle} onClose={onClose} compareKws={compareKws} compareSeries={compareSeries} compareLoading={compareLoading} />}

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

import { useState, useEffect } from 'react';

interface SourceInfo {
    name: string;
    count: number;
}

interface TrendingWord {
    word: string;
    count: number;
    sources?: SourceInfo[];
    burst?: boolean;
    burst_score?: number;
    change_pct?: number;
}

interface TopicPoint {
    date_hour: string;
    count: number;
}

interface Topic {
    keyword: string;
    total: number;
    points: TopicPoint[];
}

interface CategoryInfo {
    name: string;
    count: number;
    pct: number;
}

interface CompareSeries {
    keyword: string;
    points: TopicPoint[];
}

const PERIODS = [
    { key: 6, label: '6h' },
    { key: 12, label: '12h' },
    { key: 24, label: '24h' },
    { key: 48, label: '2d' },
    { key: 168, label: '7d' },
];

const PALETTE = [
    'bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-200',
    'bg-indigo-100 text-indigo-700 border-indigo-200 hover:bg-indigo-200',
    'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200',
    'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200',
    'bg-cyan-100 text-cyan-700 border-cyan-200 hover:bg-cyan-200',
    'bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-200',
    'bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-200',
    'bg-teal-100 text-teal-700 border-teal-200 hover:bg-teal-200',
];

const CHART_COLORS = ['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

function isBigram(w: string) { return w.includes('_'); }
function displayWord(w: string) { return w.replace(/_/g, ' '); }

function Skeleton({ className }: { className?: string }) {
    return <div className={`animate-pulse bg-gray-200 rounded ${className || ''}`} />;
}

export default function TrendingPanel({ visible, onClose, onSearch }: { visible: boolean; onClose: () => void; onSearch: (keyword: string) => void }) {
    const [tab, setTab] = useState<'hot' | 'rise' | 'chart'>('hot');
    const [period, setPeriod] = useState(24);
    const [keywords, setKeywords] = useState<TrendingWord[]>([]);
    const [topics, setTopics] = useState<Topic[]>([]);
    const [activeTopic, setActiveTopic] = useState<string | null>(null);
    const [kwLoading, setKwLoading] = useState(true);
    const [tpLoading, setTpLoading] = useState(true);
    const [activity, setActivity] = useState<{ hour: string; count: number }[]>([]);
    const [error, setError] = useState<string | null>(null);

    // Category trends
    const [categories, setCategories] = useState<CategoryInfo[]>([]);
    const [catLoading, setCatLoading] = useState(false);

    // Multi-keyword comparison
    const [compareKws, setCompareKws] = useState<string[]>([]);
    const [compareSeries, setCompareSeries] = useState<CompareSeries[]>([]);
    const [compareLoading, setCompareLoading] = useState(false);

    // AI insight
    const [insight, setInsight] = useState<{ keyword: string; text: string; loading: boolean } | null>(null);

    useEffect(() => {
        if (!visible) return;
        setError(null);
        setKwLoading(true);
        setTpLoading(true);
        setCatLoading(true);

        fetch(`/api/news/trending?hours=${period}`)
            .then(r => r.json())
            .then(data => { if (data.trending) setKeywords(data.trending); })
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
    }, [visible, period]);

    // Activity timeline from topics data
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

    // Fetch compare series when selection changes
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
    const currentTopic = activeTopic ? topics.find(t => t.keyword === activeTopic) : topics[0];
    const chartTopic = currentTopic || topics[0];

    const sortedPoints = chartTopic ? [...chartTopic.points].sort((a, b) => a.date_hour.localeCompare(b.date_hour)) : [];
    const values = sortedPoints.map(p => p.count);
    const labels = sortedPoints.map(p => p.date_hour.substring(11, 16));
    const maxCount = Math.max(...values, 1);
    const maxActivity = Math.max(...activity.map(a => a.count), 1);

    // Rising topics
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

    // Chart tab: multi-keyword comparison SVG
    function renderCompareChart() {
        if (compareLoading) {
            return (
                <div className="mt-4 bg-gray-50 rounded-xl p-4 border border-gray-100">
                    <div className="flex items-center justify-center gap-2 py-6">
                        <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                        <span className="text-[12px] text-gray-400">加载对比数据...</span>
                    </div>
                </div>
            );
        }
        if (compareSeries.length < 2) return null;
        const allPoints = compareSeries.flatMap(s => s.points);
        const allHours = [...new Set(allPoints.map(p => p.date_hour))].sort();
        if (allHours.length < 2) return null;

        const maxVal = Math.max(...allPoints.map(p => p.count), 1);
        const W = 600, H = 140, PAD = 4;

        return (
            <div className="mt-4 bg-gray-50 rounded-xl p-4 border border-gray-100">
                <div className="text-[12px] text-gray-500 mb-2 text-center font-medium">关键词对比</div>
                <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-36" preserveAspectRatio="xMidYMid meet">
                    {compareSeries.map((s, si) => {
                        const pts = allHours.map((h, i) => {
                            const p = s.points.find(p => p.date_hour === h);
                            const x = (i / (allHours.length - 1)) * (W - PAD * 2) + PAD;
                            const y = H - PAD - ((p?.count || 0) / maxVal) * (H - PAD * 2);
                            return `${x},${y}`;
                        });
                        return <polyline key={s.keyword} points={pts.join(' ')} fill="none"
                            stroke={CHART_COLORS[si % CHART_COLORS.length]} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />;
                    })}
                </svg>
                <div className="flex flex-wrap gap-3 justify-center mt-1">
                    {compareSeries.map((s, si) => (
                        <span key={s.keyword} className="text-[11px] text-gray-600 flex items-center gap-1">
                            <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: CHART_COLORS[si % CHART_COLORS.length] }} />
                            {displayWord(s.keyword)}
                        </span>
                    ))}
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/30 animate-fadeIn" onClick={onClose} />
            <div className="relative w-full max-w-md bg-white shadow-2xl h-full overflow-y-auto animate-slideIn">
                <div className="sticky top-0 bg-white/95 backdrop-blur-sm z-10 flex items-center justify-between px-5 py-3 border-b border-gray-200">
                    <div className="flex gap-1.5">
                        <button className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition cursor-pointer ${tab === 'hot' ? 'bg-indigo-500 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100'}`} onClick={() => setTab('hot')}>热词</button>
                        <button className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition cursor-pointer ${tab === 'rise' ? 'bg-indigo-500 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100'}`} onClick={() => setTab('rise')}>上升</button>
                        <button className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition cursor-pointer ${tab === 'chart' ? 'bg-indigo-500 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100'}`} onClick={() => setTab('chart')}>趋势</button>
                    </div>
                    <button className="text-gray-400 hover:text-gray-700 text-xl leading-none cursor-pointer" onClick={onClose}>&times;</button>
                </div>

                {/* Period selector — shows on all tabs */}
                <div className="px-4 pt-3 pb-2 flex gap-1 flex-wrap">
                    {PERIODS.map(p => (
                        <button key={p.key}
                            className={`px-3 py-1 rounded text-[12px] font-medium transition cursor-pointer ${period === p.key ? 'bg-indigo-100 text-indigo-700 shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                            onClick={() => { setPeriod(p.key); setCompareKws([]); }}>
                            {p.label}
                        </button>
                    ))}
                </div>

                {/* Error banner */}
                {error && (
                    <div className="mx-4 mb-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg flex items-center justify-between">
                        <span className="text-[12px] text-red-600">{error}</span>
                        <button className="text-[12px] text-red-500 font-medium cursor-pointer hover:text-red-700" onClick={() => window.location.reload()}>重试</button>
                    </div>
                )}

                <div className="p-4 pt-2">
                    {tab === 'hot' && (
                        kwLoading ? (
                            <div className="flex flex-wrap gap-2.5 justify-center py-4">
                                {Array.from({ length: 12 }).map((_, i) => (
                                    <Skeleton key={i} className={`h-${(i % 4 + 1) * 2} w-${(i % 3 + 1) * 6 + 8} rounded-xl`} />
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
                                                onClick={() => { onSearch(kw.word); onClose(); }}
                                                title={`${displayWord(kw.word)} (${kw.count})`}>
                                                {isBigram(kw.word) && <span className="text-[9px] opacity-50 font-normal mr-0.5">词组</span>}
                                                {displayWord(kw.word)}
                                                {kw.burst && <span className="absolute -top-2 -right-2 text-[14px] animate-pulse">🔥</span>}
                                                {kw.change_pct !== undefined && kw.change_pct !== 0 && (
                                                    <span className={`text-[10px] ml-1 font-semibold ${kw.change_pct > 0 ? 'text-red-500' : 'text-green-500'}`}>
                                                        {kw.change_pct > 0 ? '↑' : '↓'}{Math.abs(kw.change_pct)}%
                                                    </span>
                                                )}
                                            </button>
                                            {/* Source tags + insight button */}
                                            <div className="flex items-center gap-1 mt-0.5">
                                                {kw.sources && kw.sources.length > 0 && (
                                                    <span className="text-[9px] text-gray-400 truncate max-w-[80px]">
                                                        {kw.sources.slice(0, 2).map(s => s.name).join('/')}
                                                    </span>
                                                )}
                                                <button
                                                    className="text-[10px] text-indigo-400 hover:text-indigo-600 cursor-pointer leading-none"
                                                    onClick={(e) => { e.stopPropagation(); fetchInsight(kw.word); }}
                                                    title="AI 解读">
                                                    💡
                                                </button>
                                                <button
                                                    className={`text-[10px] cursor-pointer leading-none ${compareKws.includes(kw.word) ? 'text-indigo-500' : 'text-gray-300 hover:text-gray-500'}`}
                                                    onClick={(e) => { e.stopPropagation(); toggleCompareKw(kw.word); }}
                                                    title={compareKws.includes(kw.word) ? '取消对比' : '加入对比'}>
                                                    📊
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    )}

                    {tab === 'rise' && (
                        tpLoading ? (
                            <div className="space-y-2 py-4">
                                {Array.from({ length: 8 }).map((_, i) => (
                                    <div key={i} className="flex items-center justify-between px-3 py-2">
                                        <Skeleton className="h-4 w-32" />
                                        <Skeleton className="h-4 w-20" />
                                    </div>
                                ))}
                            </div>
                        ) : risingTopics.length === 0 ? (
                            <div className="text-center py-12 text-gray-400 text-sm">暂无足够数据计算趋势</div>
                        ) : (
                            <div className="space-y-1">
                                {risingTopics.map((r, i) => (
                                    <button key={r.keyword}
                                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 transition cursor-pointer text-left"
                                        onClick={() => { onSearch(r.keyword); onClose(); }}>
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className="text-[11px] text-gray-400 w-5 shrink-0">{i + 1}</span>
                                            <span className="text-sm text-gray-800 font-medium truncate">{r.keyword}</span>
                                            {r.burst && <span className="text-[12px]">🔥</span>}
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
                        )
                    )}

                    {tab === 'chart' && (
                        tpLoading ? (
                            <div className="space-y-4 py-4">
                                <Skeleton className="h-8 w-full" />
                                <Skeleton className="h-36 w-full" />
                                <Skeleton className="h-16 w-full" />
                            </div>
                        ) : topics.length === 0 ? (
                            <div className="text-center py-12 text-gray-400 text-sm">暂无数据</div>
                        ) : (
                            <>
                                {/* Category distribution */}
                                {!catLoading && categories.length > 0 && (
                                    <div className="mb-4 bg-gray-50 rounded-xl p-4 border border-gray-100">
                                        <div className="text-[12px] text-gray-500 mb-2 text-center font-medium">分类分布</div>
                                        <div className="space-y-1.5">
                                            {categories.slice(0, 6).map(cat => (
                                                <div key={cat.name} className="flex items-center gap-2">
                                                    <span className="text-[11px] text-gray-600 w-16 shrink-0 text-right capitalize">{cat.name}</span>
                                                    <div className="flex-1 h-4 bg-gray-200 rounded-full overflow-hidden">
                                                        <div className="h-full bg-indigo-400 rounded-full transition-all duration-500"
                                                            style={{ width: `${cat.pct}%` }} />
                                                    </div>
                                                    <span className="text-[11px] text-gray-500 w-10 shrink-0">{cat.pct}%</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {/* Keyword selector for comparison */}
                                <div className="flex flex-wrap gap-1.5 mb-4">
                                    {keywords.slice(0, 15).map(kw => (
                                        <button key={kw.word}
                                            className={`px-2.5 py-1 rounded text-[12px] font-medium transition cursor-pointer ${compareKws.includes(kw.word) ? 'bg-indigo-500 text-white' : activeTopic === kw.word ? 'bg-indigo-100 text-indigo-700' : chartTopic?.keyword === kw.word ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                                            onClick={() => {
                                                if (compareKws.includes(kw.word)) {
                                                    setCompareKws(compareKws.filter(k => k !== kw.word));
                                                } else {
                                                    if (compareKws.length < 4) setCompareKws([...compareKws, kw.word]);
                                                    setActiveTopic(kw.word);
                                                }
                                            }}>
                                            {kw.word}
                                            {compareKws.includes(kw.word) && <span className="ml-1 text-[10px]">✓</span>}
                                        </button>
                                    ))}
                                </div>

                                {/* Multi-keyword comparison chart */}
                                {compareSeries.length >= 2 && renderCompareChart()}

                                {/* Single keyword bar chart */}
                                {chartTopic && (
                                    <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                                        <div className="text-[12px] text-gray-500 mb-3 text-center font-medium">{chartTopic.keyword}</div>
                                        {values.length <= 1 ? (
                                            <div className="text-center py-8 text-gray-400 text-sm">需要更多小时的数据才能展示趋势</div>
                                        ) : (
                                            <div className="flex items-end gap-[3px] h-36">
                                                {values.map((v, i) => (
                                                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                                                        <div className="w-full bg-indigo-400 rounded-sm transition-all duration-200 hover:bg-indigo-500 cursor-pointer"
                                                            style={{ height: `${Math.max((v / maxCount) * 120, v > 0 ? 4 : 0)}px` }}
                                                            title={`${labels[i]}: ${v}`} />
                                                        {values.length <= 12 && (
                                                            <span className="text-[10px] text-gray-500 font-medium">{labels[i]}</span>
                                                        )}
                                                        {values.length > 12 && i % Math.ceil(values.length / 6) === 0 && (
                                                            <span className="text-[9px] text-gray-400">{labels[i]}</span>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Activity timeline */}
                                {activity.length > 1 && (
                                    <div className="mt-4 bg-gray-50 rounded-xl p-4 border border-gray-100">
                                        <div className="text-[12px] text-gray-500 mb-2 text-center font-medium">整体活跃度</div>
                                        <div className="flex items-end gap-[2px] h-12">
                                            {activity.map((a, i) => (
                                                <div key={i} className="flex-1 flex flex-col items-center">
                                                    <div className="w-full bg-emerald-300 rounded-sm"
                                                        style={{ height: `${Math.max((a.count / maxActivity) * 36, 2)}px` }}
                                                        title={`${a.hour.substring(11, 16)}: ${a.count}`} />
                                                    {activity.length <= 12 && (
                                                        <span className="text-[8px] text-gray-400 mt-0.5">{a.hour.substring(11, 16)}</span>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        )
                    )}
                </div>

                {/* AI Insight tooltip */}
                {insight && (
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
                )}
            </div>
        </div>
    );
}

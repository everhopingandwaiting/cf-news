import { useState, useEffect } from 'react';

interface TrendingWord {
    word: string;
    count: number;
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

export default function TrendingPanel({ visible, onClose, onSearch }: { visible: boolean; onClose: () => void; onSearch: (keyword: string) => void }) {
    const [tab, setTab] = useState<'hot' | 'rise' | 'chart'>('hot');
    const [keywords, setKeywords] = useState<TrendingWord[]>([]);
    const [topics, setTopics] = useState<Topic[]>([]);
    const [activeTopic, setActiveTopic] = useState<string | null>(null);
    const [kwLoading, setKwLoading] = useState(true);
    const [tpLoading, setTpLoading] = useState(true);
    const [activity, setActivity] = useState<{ hour: string; count: number }[]>([]);

    useEffect(() => {
        if (!visible) return;
        setKwLoading(true);
        fetch('/api/news/trending')
            .then(r => r.json())
            .then(data => { if (data.trending) setKeywords(data.trending); })
            .catch(() => {})
            .finally(() => setKwLoading(false));
        setTpLoading(true);
        fetch('/api/news/trending/topics?days=2')
            .then(r => r.json())
            .then(data => {
                if (data.topics) setTopics(data.topics);
            })
            .catch(() => {})
            .finally(() => setTpLoading(false));
    }, [visible]);

    // Build activity timeline from topics data (total keyword mentions per hour)
    useEffect(() => {
        if (topics.length === 0) return;
        const hourTotals: Record<string, number> = {};
        for (const t of topics) {
            for (const p of t.points) {
                hourTotals[p.date_hour] = (hourTotals[p.date_hour] || 0) + p.count;
            }
        }
        const sorted = Object.entries(hourTotals)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([hour, count]) => ({ hour, count }));
        setActivity(sorted);
    }, [topics]);

    if (!visible) return null;

    const maxWordCount = Math.max(...keywords.map(k => k.count), 1);
    const currentTopic = activeTopic ? topics.find(t => t.keyword === activeTopic) : topics[0];
    const chartTopic = currentTopic || topics[0];

    const sortedPoints = chartTopic ? [...chartTopic.points].sort((a, b) => a.date_hour.localeCompare(b.date_hour)) : [];
    const values = sortedPoints.map(p => p.count);
    const labels = sortedPoints.map(p => p.date_hour.substring(11, 16));
    const maxCount = Math.max(...values, 1);

    function isBigram(w: string) { return w.includes('_'); }
    function displayWord(w: string) { return w.replace(/_/g, ' '); }

    // compute rising keywords (momentum = percentage change between last 2 hours)
    const risingTopics = topics
        .map(t => {
            const sortedPts = [...t.points].sort((a, b) => a.date_hour.localeCompare(b.date_hour));
            if (sortedPts.length < 2) return null;
            const last = sortedPts[sortedPts.length - 1].count;
            const prev = sortedPts[sortedPts.length - 2].count;
            const change = last - prev;
            const pct = prev > 0 ? Math.round((change / prev) * 100) : (change > 0 ? 100 : 0);
            return { keyword: t.keyword, current: last, previous: prev, change, pct };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => b.pct - a.pct)
        .slice(0, 20);

    const maxActivity = Math.max(...activity.map(a => a.count), 1);

    const palette = [
        'bg-rose-100 text-rose-700 border-rose-200 hover:bg-rose-200',
        'bg-indigo-100 text-indigo-700 border-indigo-200 hover:bg-indigo-200',
        'bg-emerald-100 text-emerald-700 border-emerald-200 hover:bg-emerald-200',
        'bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-200',
        'bg-cyan-100 text-cyan-700 border-cyan-200 hover:bg-cyan-200',
        'bg-violet-100 text-violet-700 border-violet-200 hover:bg-violet-200',
        'bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-200',
        'bg-teal-100 text-teal-700 border-teal-200 hover:bg-teal-200',
    ];

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/30" onClick={onClose} />
            <div className="relative w-full max-w-md bg-white shadow-2xl h-full overflow-y-auto">
                <div className="sticky top-0 bg-white z-10 flex items-center justify-between px-5 py-3 border-b border-gray-200">
                    <div className="flex gap-1.5">
                        <button className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition cursor-pointer ${tab === 'hot' ? 'bg-indigo-500 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100'}`} onClick={() => setTab('hot')}>热词</button>
                        <button className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition cursor-pointer ${tab === 'rise' ? 'bg-indigo-500 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100'}`} onClick={() => setTab('rise')}>上升</button>
                        <button className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition cursor-pointer ${tab === 'chart' ? 'bg-indigo-500 text-white shadow-sm' : 'text-gray-700 hover:bg-gray-100'}`} onClick={() => setTab('chart')}>趋势</button>
                    </div>
                    <button className="text-gray-400 hover:text-gray-700 text-xl leading-none cursor-pointer" onClick={onClose}>&times;</button>
                </div>

                <div className="p-4">
                    {tab === 'hot' && (
                        kwLoading ? <div className="text-center py-12 text-gray-400 text-sm">加载中...</div>
                        : keywords.length === 0 ? <div className="text-center py-12 text-gray-400 text-sm">暂无数据</div>
                        : <div className="flex flex-wrap gap-2.5 justify-center py-2">
                            {keywords.map((kw, i) => {
                                const ratio = kw.count / maxWordCount;
                                const color = palette[i % palette.length];
                                const size = ratio > 0.8 ? 'text-base font-bold' : ratio > 0.6 ? 'text-sm font-semibold' : ratio > 0.4 ? 'text-xs font-medium' : 'text-[11px]';
                                const rotate = i % 5 === 0 ? 'rotate-[-1.5deg]' : i % 7 === 0 ? 'rotate-[1.5deg]' : '';
                                const pad = ratio > 0.6 ? 'px-3.5 py-2' : 'px-3 py-1.5';
                                return (
                                    <button key={kw.word}
                                        className={`${color} ${size} ${pad} ${rotate} rounded-xl border transition-all duration-200 cursor-pointer hover:scale-105 hover:shadow-sm active:scale-95`}
                                        onClick={() => { onSearch(kw.word); onClose(); }}
                                        title={`${displayWord(kw.word)} (${kw.count})`}>
                                        {isBigram(kw.word) && <span className="text-[9px] opacity-50 font-normal mr-0.5">词组</span>}
                                        {displayWord(kw.word)}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    {tab === 'rise' && (
                        tpLoading ? <div className="text-center py-12 text-gray-400 text-sm">加载中...</div>
                        : risingTopics.length === 0 ? <div className="text-center py-12 text-gray-400 text-sm">暂无足够数据计算趋势</div>
                        : <div className="space-y-1">
                            {risingTopics.map((r, i) => (
                                <button key={r.keyword}
                                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-gray-50 transition cursor-pointer text-left"
                                    onClick={() => { onSearch(r.keyword); onClose(); }}>
                                    <div className="flex items-center gap-2 min-w-0">
                                        <span className="text-[11px] text-gray-400 w-5 shrink-0">{i + 1}</span>
                                        <span className="text-sm text-gray-800 font-medium truncate">{r.keyword}</span>
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
                    )}

                    {tab === 'chart' && (
                        tpLoading ? <div className="text-center py-12 text-gray-400 text-sm">加载中...</div>
                        : topics.length === 0 ? <div className="text-center py-12 text-gray-400 text-sm">暂无数据</div>
                        : <>
                            <div className="flex flex-wrap gap-1.5 mb-4">
                                {topics.slice(0, 15).map(t => (
                                    <button key={t.keyword}
                                        className={`px-2.5 py-1 rounded text-[12px] font-medium transition cursor-pointer ${chartTopic?.keyword === t.keyword ? 'bg-indigo-500 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                                        onClick={() => setActiveTopic(t.keyword)}>
                                        {t.keyword} <span className="opacity-60">({t.total})</span>
                                    </button>
                                ))}
                            </div>
                            <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                                <div className="text-[12px] text-gray-500 mb-3 text-center font-medium">{chartTopic?.keyword}</div>
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
                    )}
                </div>
            </div>
        </div>
    );
}

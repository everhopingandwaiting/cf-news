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
    const [tab, setTab] = useState<'keywords' | 'topics'>('keywords');
    const [keywords, setKeywords] = useState<TrendingWord[]>([]);
    const [topics, setTopics] = useState<Topic[]>([]);
    const [activeTopic, setActiveTopic] = useState<string | null>(null);
    const [kwLoading, setKwLoading] = useState(true);
    const [tpLoading, setTpLoading] = useState(true);

    useEffect(() => {
        if (!visible) return;
        setKwLoading(true);
        fetch('/api/news/trending')
            .then(r => r.json())
            .then(data => { if (data.trending) setKeywords(data.trending); })
            .catch(() => {})
            .finally(() => setKwLoading(false));
        setTpLoading(true);
        fetch('/api/news/trending/topics?days=3')
            .then(r => r.json())
            .then(data => { if (data.topics) setTopics(data.topics); })
            .catch(() => {})
            .finally(() => setTpLoading(false));
    }, [visible]);

    if (!visible) return null;

    const maxWordCount = Math.max(...keywords.map(k => k.count), 1);
    const currentTopic = activeTopic ? topics.find(t => t.keyword === activeTopic) : topics[0];
    const chartTopic = currentTopic || topics[0];

    // Sort points chronologically (oldest first) for correct chart display
    const sortedPoints = chartTopic ? [...chartTopic.points].sort((a, b) => a.date_hour.localeCompare(b.date_hour)) : [];
    const values = sortedPoints.slice(-24).map(p => p.count);
    const labels = sortedPoints.slice(-24).map(p => {
        const d = p.date_hour;
        return d.substring(11, 16);
    });
    const maxCount = Math.max(...values, 1);

    return (
        <div className="fixed inset-0 z-50 flex justify-end">
            <div className="absolute inset-0 bg-black/20" onClick={onClose} />
            <div className="relative w-full max-w-md bg-white shadow-2xl h-full overflow-y-auto animate-[slideIn_0.2s_ease]">
                <div className="sticky top-0 bg-white z-10 flex items-center justify-between px-5 py-4 border-b border-gray-100">
                    <div className="flex gap-2">
                        <button
                            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition cursor-pointer ${tab === 'keywords' ? 'bg-indigo-500 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                            onClick={() => setTab('keywords')}
                        >趋势热词</button>
                        <button
                            className={`px-3 py-1.5 rounded-lg text-[13px] font-medium transition cursor-pointer ${tab === 'topics' ? 'bg-indigo-500 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                            onClick={() => setTab('topics')}
                        >热点追踪</button>
                    </div>
                    <button className="text-gray-400 hover:text-gray-600 text-xl leading-none cursor-pointer" onClick={onClose}>&times;</button>
                </div>

                <div className="p-5">
                    {tab === 'keywords' && (
                        kwLoading ? (
                            <div className="text-center py-10 text-gray-400 text-sm">加载中...</div>
                        ) : keywords.length === 0 ? (
                            <div className="text-center py-10 text-gray-400 text-sm">暂无数据</div>
                        ) : (
                            <div className="flex flex-wrap gap-2">
                                {keywords.map(kw => (
                                    <button
                                        key={kw.word}
                                        className={`px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 text-gray-600 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-600 transition cursor-pointer ${kw.count / maxWordCount > 0.7 ? 'text-sm font-bold' : kw.count / maxWordCount > 0.4 ? 'text-xs font-semibold' : 'text-[11px]'}`}
                                        onClick={() => { onSearch(kw.word); onClose(); }}
                                        title={`${kw.word} (${kw.count})`}
                                    >
                                        {kw.word}
                                    </button>
                                ))}
                            </div>
                        )
                    )}

                    {tab === 'topics' && (
                        tpLoading ? (
                            <div className="text-center py-10 text-gray-400 text-sm">加载中...</div>
                        ) : topics.length === 0 ? (
                            <div className="text-center py-10 text-gray-400 text-sm">暂无数据</div>
                        ) : (
                            <>
                                <div className="flex flex-wrap gap-1.5 mb-4">
                                    {topics.slice(0, 15).map(t => (
                                        <button
                                            key={t.keyword}
                                            className={`px-2 py-0.5 rounded text-[11px] transition cursor-pointer ${chartTopic?.keyword === t.keyword ? 'bg-indigo-500 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                                            onClick={() => setActiveTopic(t.keyword)}
                                        >
                                            {t.keyword} <span className="opacity-60">({t.total})</span>
                                        </button>
                                    ))}
                                </div>
                                <div className="bg-white border border-gray-100 rounded-xl p-4">
                                    <div className="text-[12px] text-gray-500 mb-3 text-center">{chartTopic?.keyword}</div>
                                    <div className="flex items-end gap-[2px] h-36">
                                        {values.map((v, i) => (
                                            <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                                                <div
                                                    className="w-full bg-indigo-400 rounded-t transition-all duration-300 hover:bg-indigo-500 cursor-pointer"
                                                    style={{ height: `${Math.max((v / maxCount) * 120, v > 0 ? 4 : 0)}px` }}
                                                    title={`${labels[i]}: ${v}`}
                                                />
                                                {values.length <= 24 && i % Math.max(1, Math.floor(values.length / 6)) === 0 && (
                                                    <span className="text-[8px] text-gray-400 -rotate-45 origin-left whitespace-nowrap">{labels[i]}</span>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </>
                        )
                    )}
                </div>
            </div>
        </div>
    );
}

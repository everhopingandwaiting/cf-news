import { useState, useEffect } from 'react';

interface TopicPoint {
    date_hour: string;
    count: number;
}

interface Topic {
    keyword: string;
    total: number;
    points: TopicPoint[];
}

export default function TrendingTopics() {
    const [topics, setTopics] = useState<Topic[]>([]);
    const [loading, setLoading] = useState(true);
    const [active, setActive] = useState<string | null>(null);

    useEffect(() => {
        fetch('/api/news/trending/topics?days=3')
            .then(r => r.json())
            .then(data => { if (data.topics) setTopics(data.topics); })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    if (loading || topics.length === 0) return null;

    const activeTopic = active ? topics.find(t => t.keyword === active) : topics[0];
    const current = activeTopic || topics[0];
    const values = current.points.slice(-12).map(p => p.count);
    const labels = current.points.slice(-12).map(p => p.date_hour.substring(11, 16));
    const maxCount = Math.max(...values, 1);

    return (
        <div className="mb-5 bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-[13px] text-gray-500 mb-3 font-medium">⟡ 热点追踪</div>
            <div className="flex flex-wrap gap-1.5 mb-3">
                {topics.slice(0, 10).map(t => (
                    <button
                        key={t.keyword}
                        className={`px-2 py-0.5 rounded text-[11px] transition cursor-pointer ${current.keyword === t.keyword ? 'bg-indigo-500 text-white' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                        onClick={() => setActive(t.keyword)}
                    >
                        {t.keyword} <span className="opacity-60">({t.total})</span>
                    </button>
                ))}
            </div>
            <div className="flex items-end gap-1 h-24">
                {values.map((v, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                        <div
                            className="w-full bg-indigo-400 rounded-t transition-all duration-300 hover:bg-indigo-500 cursor-pointer"
                            style={{ height: `${(v / maxCount) * 80}px`, minHeight: v > 0 ? '4px' : '0' }}
                            title={`${labels[i]}: ${v}`}
                        />
                        {i % 3 === 0 && <span className="text-[9px] text-gray-400 -rotate-45 origin-left whitespace-nowrap">{labels[i]}</span>}
                    </div>
                ))}
            </div>
            <div className="text-[10px] text-gray-400 mt-1 text-center">{current.keyword}</div>
        </div>
    );
}

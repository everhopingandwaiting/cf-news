import { useState, useEffect } from 'react';

interface TrendingWord {
    word: string;
    count: number;
}

export default function TrendingKeywords({ onSearch }: { onSearch: (keyword: string) => void }) {
    const [keywords, setKeywords] = useState<TrendingWord[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/news/trending')
            .then(r => r.json())
            .then(data => { if (data.trending) setKeywords(data.trending); })
            .catch(() => {})
            .finally(() => setLoading(false));
    }, []);

    if (loading || keywords.length === 0) return null;

    const maxCount = Math.max(...keywords.map(k => k.count), 1);

    return (
        <div className="mb-5">
            <div className="text-[13px] text-gray-500 mb-2.5 font-medium">⟡ 趋势热词</div>
            <div className="flex flex-wrap gap-2">
                {keywords.map(kw => (
                    <button
                        key={kw.word}
                        className={`px-2.5 py-1 rounded-full bg-gray-50 border border-gray-200 text-gray-600 hover:bg-indigo-50 hover:border-indigo-300 hover:text-indigo-600 transition cursor-pointer ${kw.count / maxCount > 0.7 ? 'text-sm font-bold' : kw.count / maxCount > 0.4 ? 'text-xs font-semibold' : 'text-[11px]'}`}
                        onClick={() => onSearch(kw.word)}
                        title={`${kw.word} (${kw.count})`}
                    >
                        {kw.word}
                    </button>
                ))}
            </div>
        </div>
    );
}

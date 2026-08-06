import { MAX_KEYWORD_SELECTOR, MAX_COMPARE_KWS } from './types';
import { Skeleton } from './types';
import type { Topic, TrendingWord, CategoryInfo, CompareSeries } from './types';
import TrendingCompareChart from '../TrendingCompareChart';
import { Icon, EmptyState } from './icons';

interface TrendingChartTabProps {
    tpLoading: boolean;
    topics: Topic[];
    activeTopic: string | null;
    setActiveTopic: (v: string | null) => void;
    categories: CategoryInfo[];
    catLoading: boolean;
    keywords: TrendingWord[];
    compareKws: string[];
    setCompareKws: (v: string[]) => void;
    compareSeries: CompareSeries[];
    compareLoading: boolean;
    activity: { hour: string; count: number }[];
}

export default function TrendingChartTab({
    tpLoading, topics, activeTopic, setActiveTopic,
    categories, catLoading, keywords,
    compareKws, setCompareKws, compareSeries, compareLoading,
    activity,
}: TrendingChartTabProps) {
    if (tpLoading) {
        return (
            <div className="space-y-4 py-4">
                <Skeleton className="h-8 w-full" />
                <Skeleton className="h-36 w-full" />
                <Skeleton className="h-16 w-full" />
            </div>
        );
    }

    if (topics.length === 0) {
        return <EmptyState icon="chart" title="暂无数据" hint="试试切换时间范围" />;
    }

    const chartTopic = (activeTopic ? topics.find(t => t.keyword === activeTopic) : null) || topics[0];
    const sortedPoints = chartTopic ? [...chartTopic.points].sort((a, b) => a.date_hour.localeCompare(b.date_hour)) : [];
    const values = sortedPoints.map(p => p.count);
    const labels = sortedPoints.map(p => p.date_hour.substring(11, 16));
    const maxCount = Math.max(...values, 1);
    const maxActivity = Math.max(...activity.map(a => a.count), 1);

    return (
        <>
            {!catLoading && categories.length > 0 && (
                <div className="mb-4 bg-gray-50 rounded-xl p-4 border border-gray-100">
                    <div className="text-[12px] text-gray-500 mb-2 text-center font-medium flex items-center justify-center gap-1"><Icon name="grid" className="w-3.5 h-3.5" />分类分布</div>
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

            <div className="flex flex-wrap gap-1.5 mb-4">
                {keywords.slice(0, MAX_KEYWORD_SELECTOR).map(kw => (
                    <button key={kw.word}
                        className={`px-2.5 py-1 rounded text-[12px] font-medium transition cursor-pointer ${compareKws.includes(kw.word) ? 'bg-indigo-500 text-white' : activeTopic === kw.word ? 'bg-indigo-100 text-indigo-700' : chartTopic?.keyword === kw.word ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                        onClick={() => {
                            if (compareKws.includes(kw.word)) {
                                setCompareKws(compareKws.filter(k => k !== kw.word));
                            } else {
                                if (compareKws.length < MAX_COMPARE_KWS) setCompareKws([...compareKws, kw.word]);
                                setActiveTopic(kw.word);
                            }
                        }}>
                        {kw.word}
                        {compareKws.includes(kw.word) && <span className="ml-1 text-[10px]">✓</span>}
                    </button>
                ))}
            </div>

            {compareSeries.length >= 2 && <TrendingCompareChart series={compareSeries} loading={compareLoading} />}

            {chartTopic && (
                <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
                    <div className="text-[12px] text-gray-500 mb-3 text-center font-medium flex items-center justify-center gap-1"><Icon name="chart" className="w-3.5 h-3.5" />{chartTopic.keyword}</div>
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

            {activity.length > 1 && (
                <div className="mt-4 bg-gray-50 rounded-xl p-4 border border-gray-100">
                    <div className="text-[12px] text-gray-500 mb-2 text-center font-medium flex items-center justify-center gap-1"><Icon name="trending" className="w-3.5 h-3.5" />整体活跃度</div>
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
    );
}

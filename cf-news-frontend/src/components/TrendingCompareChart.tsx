interface TopicPoint {
    date_hour: string;
    count: number;
}

interface CompareSeries {
    keyword: string;
    points: TopicPoint[];
}

interface Props {
    series: CompareSeries[];
    loading: boolean;
}

const CHART_COLORS = ['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

function displayWord(w: string) { return w.replace(/_/g, ' '); }

export default function TrendingCompareChart({ series, loading }: Props) {
    if (loading) {
        return (
            <div className="mt-4 bg-gray-50 rounded-xl p-4 border border-gray-100">
                <div className="flex items-center justify-center gap-2 py-6">
                    <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-[12px] text-gray-400">加载对比数据...</span>
                </div>
            </div>
        );
    }
    if (series.length < 2) return null;

    const allPoints = series.flatMap(s => s.points);
    const allHours = [...new Set(allPoints.map(p => p.date_hour))].sort();
    if (allHours.length < 2) return null;

    const maxVal = Math.max(...allPoints.map(p => p.count), 1);
    const W = 600, H = 140, PAD = 4;

    return (
        <div className="mt-4 bg-gray-50 rounded-xl p-4 border border-gray-100">
            <div className="text-[12px] text-gray-500 mb-2 text-center font-medium">关键词对比</div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-36" preserveAspectRatio="xMidYMid meet">
                {series.map((s, si) => {
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
                {series.map((s, si) => (
                    <span key={s.keyword} className="text-[11px] text-gray-600 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: CHART_COLORS[si % CHART_COLORS.length] }} />
                        {displayWord(s.keyword)}
                    </span>
                ))}
            </div>
        </div>
    );
}

import { EmptyState } from './trending/icons';

interface HourlySource {
    hour: string; source_id: number; source_name: string; count: number;
}
interface HourlyCat {
    hour: string; category: string; count: number;
}
type HourlyRow = HourlySource | HourlyCat;

interface Props {
    mode: 'sources' | 'cats';
    sources: HourlySource[];
    categories: HourlyCat[];
    loading: boolean;
}

const CHART_COLORS = ['#6366f1', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

export default function TrendingHourlyChart({ mode, sources, categories, loading }: Props) {
    const raw = mode === 'sources' ? sources : categories;

    if (loading) {
        return (
            <div className="mt-4 bg-gray-50 rounded-xl p-4 border border-gray-100">
                <div className="flex items-center justify-center gap-2 py-6">
                    <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />
                    <span className="text-[12px] text-gray-400">加载数据...</span>
                </div>
            </div>
        );
    }
    if (raw.length === 0) {
        return <EmptyState icon="chart" title="暂无数据" hint="试试切换时间范围" />;
    }

    const hours = [...new Set(raw.map(r => r.hour))].sort();
    const getName = (r: HourlyRow): string => mode === 'sources' ? (r as HourlySource).source_name : (r as HourlyCat).category;
    const groups = [...new Set(raw.map(getName))] as string[];
    let topGroups: string[];
    let otherLabel = '';
    if (mode === 'sources') {
        const totals: Record<string, number> = {};
        for (const r of raw) totals[getName(r)] = (totals[getName(r)] || 0) + r.count;
        topGroups = groups.sort((a, b) => (totals[b] || 0) - (totals[a] || 0)).slice(0, 6);
        otherLabel = '其他';
    } else {
        topGroups = groups;
    }

    const series: Record<string, number[]> = {};
    for (const g of topGroups) series[g] = hours.map(() => 0);
    if (otherLabel) series[otherLabel] = hours.map(() => 0);
    for (const r of raw) {
        const hi = hours.indexOf(r.hour);
        const name = getName(r);
        if (topGroups.includes(name)) {
            series[name][hi] += r.count;
        } else if (otherLabel) {
            series[otherLabel][hi] += r.count;
        }
    }

    if (hours.length <= 1) {
        return (
            <div className="mt-4 bg-gray-50 rounded-xl p-4 border border-gray-100">
                <div className="text-[12px] text-gray-500 mb-2 text-center font-medium">{mode === 'sources' ? '每小时源分布' : '每小时类分布'}</div>
                <div className="text-center py-8 text-gray-400 text-sm">需要更多小时的数据</div>
            </div>
        );
    }

    const maxTotal = Math.max(...hours.map((_, i) => Object.values(series).reduce((s, arr) => s + arr[i], 0)), 1);
    const H = 140, W = 600, PAD = 4;

    return (
        <div className="mt-4 bg-gray-50 rounded-xl p-4 border border-gray-100">
            <div className="text-[12px] text-gray-500 mb-2 text-center font-medium">{mode === 'sources' ? '每小时源分布' : '每小时类分布'}</div>
            <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-36" preserveAspectRatio="xMidYMid meet">
                {hours.map((h, hi) => {
                    let yOff = 0;
                    const barW = (W - PAD * 2) / hours.length * 0.7;
                    const x = hi * (W - PAD * 2) / hours.length + PAD + ((W - PAD * 2) / hours.length - barW) / 2;
                    return Object.keys(series).map((g, gi) => {
                        const val = series[g][hi];
                        if (val === 0) return null;
                        const barH = (val / maxTotal) * (H - PAD * 2);
                        const y = H - PAD - yOff - barH;
                        yOff += barH;
                        return <g key={`${h}-${gi}`}><rect x={x} y={y} width={barW} height={barH}
                            fill={CHART_COLORS[gi % CHART_COLORS.length]} rx={1} opacity={0.9} /><title>{g}: {val}</title></g>;
                    });
                })}
            </svg>
            <div className="flex mt-1" style={{ paddingLeft: `${PAD}px` }}>
                {hours.map((h, i) => (
                    <div key={h} className="flex-1 text-[9px] text-gray-400 text-center truncate"
                        style={{ display: hours.length > 12 && i % Math.ceil(hours.length / 8) !== 0 ? 'none' : 'block' }}>
                        {h.substring(11, 16)}
                    </div>
                ))}
            </div>
            <div className="flex flex-wrap gap-2 justify-center mt-2">
                {Object.keys(series).map((g, gi) => (
                    <span key={g} className="text-[10px] text-gray-600 flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm inline-block" style={{ backgroundColor: CHART_COLORS[gi % CHART_COLORS.length] }} />
                        {g}
                    </span>
                ))}
            </div>
        </div>
    );
}

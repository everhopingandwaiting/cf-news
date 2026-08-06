import { PERIODS } from './types';

interface PeriodSelectorProps {
    period: number;
    onChange: (period: number) => void;
}

export default function PeriodSelector({ period, onChange }: PeriodSelectorProps) {
    return (
        <div className="px-4 pt-3 pb-2 flex gap-1 flex-wrap">
            {PERIODS.map(p => (
                <button key={p.key}
                    className={`px-3 py-1 rounded text-[12px] font-medium transition cursor-pointer ${period === p.key ? 'bg-indigo-500 text-white shadow-sm' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                    onClick={() => onChange(p.key)}>
                    {p.label}
                </button>
            ))}
        </div>
    );
}

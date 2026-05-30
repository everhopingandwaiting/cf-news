import type { NewsSource } from '../types';

interface Props { sources: NewsSource[]; selected: number | null; onSelect: (id: number | null) => void; }

export default function SourceFilter({ sources, selected, onSelect }: Props) {
  const grouped: Record<string, NewsSource[]> = {};
  sources.forEach(s => { if (!grouped[s.language]) grouped[s.language] = []; grouped[s.language].push(s); });

  return (
    <div className="source-filter">
      <select className="px-3.5 py-3 bg-white text-gray-900 border border-gray-200 rounded-lg text-[13px] cursor-pointer outline-none focus:border-indigo-500" value={selected ?? ''} onChange={e => onSelect(e.target.value ? Number(e.target.value) : null)}>
        <option value="">全部来源</option>
        {Object.entries(grouped).map(([lang, list]) => (
          <optgroup key={lang} label={lang === 'zh' ? '🇨🇳 中文' : lang === 'ja' ? '🇯🇵 日本語' : lang === 'ko' ? '🇰🇷 한국어' : '🌍 英文'}>
            {list.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  );
}

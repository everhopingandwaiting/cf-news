import { useState, useRef, useEffect } from 'react';
import type { DailyDigest as DailyDigestType } from '../types';

const COPY_MAX_LEN = 3000;

interface Props {
  digest: DailyDigestType | null;
  loading: boolean;
  collapsed: boolean;
  regenerating: boolean;
  dates: string[];
  onToggle: () => void;
  onRegenerate: () => void;
  onDateChange: (date: string) => void;
}

export default function DailyDigest({ digest, loading, collapsed, regenerating, dates, onToggle, onRegenerate, onDateChange }: Props) {
  const [copied, setCopied] = useState(false);
  const [showDates, setShowDates] = useState(false);
  const dateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showDates) return;
    function handleClick(e: MouseEvent) {
      if (dateRef.current && !dateRef.current.contains(e.target as Node)) {
        setShowDates(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showDates]);

  if (!digest && !loading) return null;

  async function handleCopy() {
    if (!digest) return;
    try {
      let content = digest.content;
      const truncated = content.length > COPY_MAX_LEN;
      if (truncated) {
        content = content.slice(0, content.lastIndexOf('\n', COPY_MAX_LEN));
      }
      const footer = truncated
        ? `\n\n…… 内容较长已截断，查看完整全文请访问:\n📡 ${location.origin}`
        : `\n\n——\n📡 CF News: ${location.origin}`;
      await navigator.clipboard.writeText(`📰 今日要闻 ${digest.date}\n\n${content}${footer}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  function handleSelectDate(date: string) {
    setShowDates(false);
    onDateChange(date);
  }

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-5 mb-5 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-5 h-5 bg-gray-200 rounded animate-pulse" />
          <div className="h-4 w-24 bg-gray-200 rounded animate-pulse" />
        </div>
        <div className="space-y-2">
          <div className="h-3 bg-gray-100 rounded animate-pulse w-full" />
          <div className="h-3 bg-gray-100 rounded animate-pulse w-3/4" />
          <div className="h-3 bg-gray-100 rounded animate-pulse w-5/6" />
          <div className="h-3 bg-gray-100 rounded animate-pulse w-2/3" />
        </div>
      </div>
    );
  }

  if (!digest) return null;

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm mb-5 overflow-hidden">
      <button
        className="w-full flex items-center justify-between px-5 py-3.5 bg-gradient-to-r from-indigo-50 to-purple-50 hover:from-indigo-100 hover:to-purple-100 transition cursor-pointer"
        onClick={onToggle}
      >
        <div className="flex items-center gap-2.5">
          <span className="font-semibold text-[14px] text-gray-800">今日要闻</span>
          <span className="text-[12px] text-gray-400 font-normal">{digest.date}</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="relative" ref={dateRef}>
            <span
              className="text-[13px] text-gray-300 hover:text-indigo-500 cursor-pointer transition px-1"
              onClick={e => { e.stopPropagation(); setShowDates(!showDates); }}
              title="查看历史要闻"
            >历史</span>
            {showDates && dates.length > 0 && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[120px] z-10 animate-[slideUp_0.15s_ease]">
                {dates.map(d => (
                  <button
                    key={d}
                    className={`block w-full text-left px-4 py-1.5 text-[13px] hover:bg-gray-50 transition ${d === digest.date ? 'text-indigo-600 font-medium' : 'text-gray-600'}`}
                    onClick={() => handleSelectDate(d)}
                  >
                    {d}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className={`text-gray-400 text-lg transition-transform duration-200 ${collapsed ? '' : 'rotate-180'}`}>
            ▾
          </span>
        </div>
      </button>
      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden ${
          collapsed ? 'max-h-0 opacity-0' : 'max-h-[600px] opacity-100'
        }`}
      >
        <div className="border-t border-gray-100">
          <div className="px-5 py-4 max-h-[400px] overflow-y-auto text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
            {digest.content}
          </div>
          <div className="flex gap-2 px-5 py-3 border-t border-gray-100">
            <button
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-200 bg-transparent text-gray-500 hover:bg-gray-50 hover:text-indigo-500 transition"
              onClick={handleCopy}
            >
              {copied ? '✓ 已复制' : '⇋ 复制'}
            </button>
            <button
              className="px-3 py-1.5 rounded-lg text-[12px] font-medium border border-gray-200 bg-transparent text-gray-500 hover:bg-gray-50 hover:text-amber-500 transition disabled:opacity-40"
              onClick={onRegenerate}
              disabled={regenerating}
            >
              {regenerating ? '生成中...' : '重新生成'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

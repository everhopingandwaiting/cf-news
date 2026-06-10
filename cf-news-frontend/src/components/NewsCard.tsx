import { useState } from 'react';
import type { NewsItem } from '../types';
import { addFavorite, removeFavorite } from '../api/client';
import Comments from './Comments';

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

function formatTime(dateStr: string): string {
  if (!dateStr) return '';
  // Normalize: if no timezone info, assume China time (UTC+8) since created_at uses it
  const normalized = dateStr.includes('T') ? dateStr : dateStr.replace(' ', 'T') + '+08:00';
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return dateStr.substring(0, 16);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

const CAT_NAMES: Record<string, string> = { ai: 'AI', tech: '科技', news: '新闻', finance: '财经', entertainment: '娱乐', stocks: '股票', funds: '基金', energy: '新能源', general: '综合' };
const CAT_COLORS: Record<string, string> = {
  ai: 'bg-purple-100 text-purple-600', tech: 'bg-emerald-100 text-emerald-600',
  news: 'bg-blue-100 text-blue-600', finance: 'bg-amber-100 text-amber-600',
  entertainment: 'bg-pink-100 text-pink-600',
  stocks: 'bg-rose-100 text-rose-600', funds: 'bg-yellow-100 text-yellow-700',
  energy: 'bg-green-100 text-green-600',
};

interface Props {
  item: NewsItem;
  token: string | null;
  onAuthRequired: () => void;
  onSelect: (item: NewsItem) => void;
}

export default function NewsCard({ item, token, onAuthRequired, onSelect }: Props) {
  const [favorited, setFavorited] = useState(item.favorited || false);
  const [favCount, setFavCount] = useState(item.favorites_count || 0);
  const [showComments, setShowComments] = useState(false);

  const cat = item.category || 'general';
  const pubDate = formatTime(item.published_at || '');
  const fetchDate = formatTime(item.created_at || '');

  async function toggleFav(e: React.MouseEvent) {
    e.stopPropagation();
    if (!token) { onAuthRequired(); return; }
    try {
      if (favorited) { await removeFavorite(item.id); setFavorited(false); setFavCount(c => Math.max(0, c - 1)); }
      else { await addFavorite(item.id); setFavorited(true); setFavCount(c => c + 1); }
    } catch {}
  }

  return (
    <div id={`news-${item.id}`} className="bg-white rounded-lg p-4 border border-gray-200 shadow-sm hover:border-indigo-400 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200 cursor-pointer relative" onClick={() => onSelect(item)}>
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="min-w-0 flex items-center gap-2 text-[12px] text-gray-400">
          <span className="truncate">{item.source_name || '未知来源'}</span>
          {pubDate && <span className="shrink-0">{pubDate}</span>}
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wide uppercase ${CAT_COLORS[cat] || 'bg-gray-100 text-gray-500'}`}>{CAT_NAMES[cat] || cat}</span>
      </div>
      <h3 className="text-base font-semibold mb-2.5 leading-snug line-clamp-2 text-gray-900">
        {item.title}
        {item.ai_take && <span className="inline-block ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-600 align-middle">AI</span>}
      </h3>
      {item.ai_summary && <p className="bg-gradient-to-r from-indigo-50 to-purple-50 px-3.5 py-2.5 rounded-lg mb-3 text-[13px] text-gray-600 leading-relaxed border-l-[3px] border-indigo-500">{stripHtml(item.ai_summary)}</p>}
      {!item.ai_summary && item.description && <p className="text-gray-500 text-[13px] leading-relaxed mb-3.5 line-clamp-3">{stripHtml(item.description.substring(0, 200))}</p>}
      <div className="flex items-center justify-between text-gray-400 text-[12px]">
        <span className="opacity-70">抓取 {fetchDate || '-'}</span>
        <span className="flex gap-2">
          <button className={`flex items-center gap-1 text-[12px] px-1.5 py-1 rounded-md hover:bg-gray-100 hover:text-gray-600 transition ${favorited ? 'text-amber-500' : ''}`} onClick={toggleFav}>收藏 {favCount}</button>
          <button className="flex items-center gap-1 text-[12px] px-1.5 py-1 rounded-md hover:bg-gray-100 hover:text-gray-600 transition" onClick={e => { e.stopPropagation(); setShowComments(!showComments); }}>评论 {item.comments_count || 0}</button>
        </span>
      </div>
      {showComments && <div onClick={e => e.stopPropagation()}><Comments newsId={item.id} token={token} /></div>}
    </div>
  );
}

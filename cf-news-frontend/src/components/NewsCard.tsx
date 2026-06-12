import { useState } from 'react';
import type { NewsItem } from '../types';
import { addFavorite, addReadLater, removeFavorite } from '../api/client';
import { stripHtml, formatTime, CAT_NAMES, CAT_COLORS } from '../utils/newsFormat';
import Comments from './Comments';

interface Props {
  item: NewsItem;
  token: string | null;
  onAuthRequired: () => void;
  onSelect: (item: NewsItem) => void;
}

export default function NewsCard({ item, token, onAuthRequired, onSelect }: Props) {
  const [favorited, setFavorited] = useState(item.favorited || false);
  const [favCount, setFavCount] = useState(item.favorites_count || 0);
  const [savedLater, setSavedLater] = useState(false);
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

  async function saveLater(e: React.MouseEvent) {
    e.stopPropagation();
    if (!token) { onAuthRequired(); return; }
    try {
      await addReadLater(item.id);
      setSavedLater(true);
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
          <button className={`flex items-center gap-1 text-[12px] px-1.5 py-1 rounded-md hover:bg-gray-100 hover:text-gray-600 transition ${savedLater ? 'text-indigo-500' : ''}`} onClick={saveLater}>{savedLater ? '已稍后读' : '稍后读'}</button>
          <button className="flex items-center gap-1 text-[12px] px-1.5 py-1 rounded-md hover:bg-gray-100 hover:text-gray-600 transition" onClick={e => { e.stopPropagation(); setShowComments(!showComments); }}>评论 {item.comments_count || 0}</button>
        </span>
      </div>
      {showComments && <div onClick={e => e.stopPropagation()}><Comments newsId={item.id} token={token} /></div>}
    </div>
  );
}

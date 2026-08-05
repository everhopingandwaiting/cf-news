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
  // RSS 外链图经常失效，加载失败后隐藏整张图，避免破图占位
  const [imgError, setImgError] = useState(false);

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
      {item.image_url && !imgError && (
        <img
          src={item.image_url}
          alt=""
          loading="lazy"
          onClick={e => e.stopPropagation()}
          onError={() => setImgError(true)}
          className="w-full aspect-[16/9] object-cover rounded-lg mb-3"
        />
      )}
      <div className="flex items-center justify-between gap-3 mb-2">
        <div className="min-w-0 flex items-center gap-2 text-[12px] text-gray-400">
          <span className="truncate">{item.source_name || '未知来源'}</span>
          {pubDate && <span className="shrink-0">{pubDate}</span>}
        </div>
        <span className={`shrink-0 px-2 py-0.5 rounded-md text-[10px] font-semibold tracking-wide uppercase ${CAT_COLORS[cat] || 'bg-gray-100 text-gray-500'}`}>{CAT_NAMES[cat] || cat}</span>
      </div>
      <h3 className="text-base font-semibold mb-2.5 leading-snug line-clamp-2 text-gray-900">
        {item.title}
        {item.ai_take && <span className="inline-block ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-indigo-100 text-indigo-600 align-middle">AI</span>}
      </h3>
      {item.ai_summary && (
        <div className="bg-gradient-to-br from-indigo-50 via-white to-purple-50 px-3.5 py-2.5 rounded-lg mb-3 border-l-[3px] border-indigo-500">
          <div className="flex items-center gap-1 mb-1">
            <svg className="w-3.5 h-3.5 text-indigo-500 shrink-0" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z" />
            </svg>
            <span className="text-[10px] font-bold text-indigo-500 tracking-wide">AI 摘要</span>
          </div>
          <p className="text-[13px] text-gray-600 leading-relaxed">{stripHtml(item.ai_summary)}</p>
        </div>
      )}
      {!item.ai_summary && item.description && <p className="text-gray-500 text-[13px] leading-relaxed mb-3.5 line-clamp-3">{stripHtml(item.description.substring(0, 200))}</p>}
      <div className="flex items-center justify-between text-gray-400 text-[12px]">
        <span className="opacity-70">抓取 {fetchDate || '-'}</span>
        <span className="flex gap-2">
          <button className={`flex items-center gap-1 text-[12px] px-1.5 py-1 rounded-md hover:bg-gray-100 hover:text-gray-600 transition ${favorited ? 'text-amber-500' : ''}`} onClick={toggleFav}>
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill={favorited ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
            </svg>
            收藏 {favCount}
          </button>
          <button className={`flex items-center gap-1 text-[12px] px-1.5 py-1 rounded-md hover:bg-gray-100 hover:text-gray-600 transition ${savedLater ? 'text-indigo-500' : ''}`} onClick={saveLater}>
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill={savedLater ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M17.593 3.322c-1.1.128-1.907 1.077-1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
            </svg>
            {savedLater ? '已稍后读' : '稍后读'}
          </button>
          <button className="flex items-center gap-1 text-[12px] px-1.5 py-1 rounded-md hover:bg-gray-100 hover:text-gray-600 transition" onClick={e => { e.stopPropagation(); setShowComments(!showComments); }}>
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.25 12.76c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
            评论 {item.comments_count || 0}
          </button>
        </span>
      </div>
      {showComments && <div onClick={e => e.stopPropagation()}><Comments newsId={item.id} token={token} /></div>}
    </div>
  );
}

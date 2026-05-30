import { useState, useEffect } from 'react';
import type { NewsItem } from '../types';
import { triggerSummarizeOne, getNewsItem, triggerTake } from '../api/client';
import Comments from './Comments';

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim();
}

const EVIL_ATTR_RE = /on\w+\s*=\s*["'][^"']*["']/gi;
function sanitizeHtml(html: string): string {
  let safe = html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/<object[\s\S]*?<\/object>/gi, '')
    .replace(/<embed[\s\S]*?\/?>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<link[\s\S]*?\/?>/gi, '')
    .replace(/<form[\s\S]*?<\/form>/gi, '')
    .replace(/<input[\s\S]*?\/?>/gi, '')
    .replace(/<textarea[\s\S]*?<\/textarea>/gi, '')
    .replace(EVIL_ATTR_RE, '');
  safe = safe.replace(/<img\s/gi, '<img referrerpolicy="no-referrer" ');
  safe = safe.replace(/<img\s[^>]*src="(https?:\/\/[^"]+)"[^>]*>/gi, (match, src) => {
    if (src.startsWith(window.location.origin)) return match;
    return match.replace(src, `/api/image?url=${encodeURIComponent(src)}`);
  });
  return safe;
}

function formatTime(dateStr: string): string {
  if (!dateStr) return '';
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

const CAT_NAMES: Record<string, string> = {
  ai: '⟡ AI', tech: '⚙ 科技', news: '◇ 新闻', finance: '₿ 财经', entertainment: '✦ 娱乐', general: '◇ 综合',
};
const CAT_COLORS: Record<string, string> = {
  ai: 'bg-purple-100 text-purple-600', tech: 'bg-emerald-100 text-emerald-600',
  news: 'bg-blue-100 text-blue-600', finance: 'bg-amber-100 text-amber-600',
  entertainment: 'bg-pink-100 text-pink-600',
};

interface Props {
  item: NewsItem | null;
  token: string | null;
  onClose: () => void;
  onOpenUrl: (url: string) => void;
  onSummaryGenerated: () => void;
}

export default function NewsDetailModal({ item, token, onClose, onOpenUrl, onSummaryGenerated }: Props) {
  const [summarizing, setSummarizing] = useState(false);
  const [taking, setTaking] = useState(false);
  const [takeError, setTakeError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [currentItem, setCurrentItem] = useState<NewsItem | null>(null);
  const [translating, setTranslating] = useState(false);
  const [translated, setTranslated] = useState<{ title?: string; description?: string } | null>(null);

  useEffect(() => { setCurrentItem(item); setTranslated(null); setTakeError(false); }, [item]);

  async function handleTake() {
    if (!currentItem) return;
    setTaking(true);
    setTakeError(false);
    try {
      const data = await triggerTake(currentItem.id);
      if (data.take) {
        setCurrentItem({ ...currentItem, ai_take: data.take });
        onSummaryGenerated();
      } else {
        setTakeError(true);
      }
    } catch {
      setTakeError(true);
    }
    setTaking(false);
  }

  async function handleSummarize() {
    if (!currentItem) return;
    setSummarizing(true);
    try {
      await triggerSummarizeOne(itemId);
      const updated = await getNewsItem(itemId);
      if (updated) setCurrentItem(updated);
      onSummaryGenerated();
    } catch {}
    setSummarizing(false);
  }

  async function handleTranslate() {
    if (!currentItem) return;
    setTranslating(true);
    try {
      const text = stripHtml(currentItem.description || currentItem.content || '');
      const res = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, lang: 'zh' }),
      });
      const data = await res.json();
      if (data.translated) {
        setTranslated({ title: currentItem.title, description: data.translated });
      }
    } catch {}
    setTranslating(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  }

  if (!currentItem) return null;

  const itemId = currentItem.id;
  const cat = currentItem.category || 'general';
  const raw = (currentItem.published_at || currentItem.created_at || '');
  const date = formatTime(raw);
  const shareUrl = `${window.location.origin}/share/${itemId}`;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-content bg-white rounded-2xl p-8 w-full max-w-[640px] max-h-[85vh] border border-gray-200 shadow-xl animate-[slideUp_0.25s_ease] relative overflow-y-auto">
        <button className="absolute top-4 right-4 w-9 h-9 rounded-full bg-gray-100 border border-gray-200 text-gray-400 cursor-pointer text-base flex items-center justify-center hover:bg-gray-200 hover:text-gray-600 transition" onClick={onClose}>✕</button>

        <div className="flex gap-2.5 items-center mb-4">
          <span className={`px-2.5 py-1 rounded-full text-[12px] font-semibold ${CAT_COLORS[cat] || 'bg-gray-100 text-gray-500'}`}>{CAT_NAMES[cat] || cat}</span>
          <span className="text-[13px] text-gray-400">{currentItem.source_name}</span>
        </div>

        <h2 className="text-[22px] font-bold leading-snug mb-3 text-gray-900">{currentItem.title}</h2>

        <div className="flex gap-4 text-[13px] text-gray-400 mb-5">
          <span>◷ {date}</span>
          <span>◈ {currentItem.source_lang === 'zh' ? '中文' : '英文'}</span>
        </div>

        {currentItem.ai_summary ? (
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 px-5 py-4 rounded-lg mb-5 border-l-[3px] border-indigo-500">
            <div className="font-semibold text-[13px] text-indigo-500 mb-2">⟡ AI 摘要</div>
            <p className="text-sm text-gray-600 leading-relaxed">{stripHtml(currentItem.ai_summary)}</p>
          </div>
        ) : (
          <button type="button" className="mb-4 px-4 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 hover:border-indigo-500 hover:text-indigo-500 transition disabled:opacity-40" onClick={handleSummarize} disabled={summarizing}>
            {summarizing ? '⟡ 生成中...' : '⟡ 生成 AI 摘要'}
          </button>
        )}

        {currentItem.ai_take ? (
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-4 rounded-lg mb-5 border-l-[3px] border-amber-400">
            <div className="font-semibold text-[13px] text-amber-600 mb-2">✎ AI 小编</div>
            <p className="text-sm text-amber-700 italic">{currentItem.ai_take}</p>
          </div>
        ) : currentItem.ai_summary ? (
          <div className="mb-4">
            {takeError && <p className="text-[12px] text-red-400 mb-1">⏱ 生成失败，可重试</p>}
            <button type="button" className="px-4 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 hover:border-amber-500 hover:text-amber-500 transition disabled:opacity-40" onClick={handleTake} disabled={taking}>
              {taking ? '✎ AI 思考中...' : '✎ 生成 AI 吐槽'}
            </button>
          </div>
        ) : null}

        {currentItem.source_lang !== 'zh' && (
          <button type="button" className="mb-4 ml-2 px-4 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 hover:border-emerald-500 hover:text-emerald-500 transition disabled:opacity-40" onClick={handleTranslate} disabled={translating}>
            {translating ? '🌐 翻译中...' : '🌐 翻译为中文'}
          </button>
        )}

        {translated && (
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-5 py-4 rounded-lg mb-5 border-l-[3px] border-emerald-500">
            <div className="font-semibold text-[13px] text-emerald-600 mb-2">🌐 中文翻译</div>
            <p className="text-sm text-gray-600 leading-relaxed">{translated.description}</p>
          </div>
        )}

        {currentItem!.description && <div className="text-sm text-gray-600 leading-relaxed mb-4 news-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentItem!.description) }} />}
        {currentItem!.content && <div className="text-sm text-gray-600 leading-relaxed mb-4 news-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentItem!.content) }} />}

        <style>{`.news-content img { max-width: 100%; height: auto; border-radius: 8px; } .news-content a { color: #6366f1; text-decoration: underline; }`}</style>

        <div className="mt-5 pt-4 border-t border-gray-200">
          <Comments newsId={currentItem!.id} token={token} />
        </div>

        <div className="flex gap-3 mt-4 flex-wrap">
          <button className="px-5 py-2.5 bg-indigo-500 text-white rounded-lg text-[13px] font-medium hover:bg-indigo-600 transition" onClick={() => onOpenUrl(currentItem!.url)}>◈ 阅读原文</button>
          <button className="px-5 py-2.5 rounded-lg text-[13px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 transition" onClick={copyLink}>
            {copied ? '✓ 已复制' : '⇋ 复制链接'}
          </button>
          <div className="relative group">
            <button className="px-5 py-2.5 rounded-lg text-[13px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 transition">↗ 分享到</button>
            <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px] opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
              <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(currentItem!.title)}&url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noopener noreferrer" className="block px-4 py-2 text-[13px] text-gray-700 hover:bg-gray-50">𝕏 Twitter</a>
              <a href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(currentItem!.title)}`} target="_blank" rel="noopener noreferrer" className="block px-4 py-2 text-[13px] text-gray-700 hover:bg-gray-50">✈ Telegram</a>
              <a href={`https://wa.me/?text=${encodeURIComponent(currentItem!.title + ' ' + shareUrl)}`} target="_blank" rel="noopener noreferrer" className="block px-4 py-2 text-[13px] text-gray-700 hover:bg-gray-50">💬 WhatsApp</a>
              <button onClick={copyLink} className="block w-full text-left px-4 py-2 text-[13px] text-gray-700 hover:bg-gray-50">🔗 复制链接</button>
            </div>
          </div>
          <button className="px-5 py-2.5 rounded-lg text-[13px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 transition" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

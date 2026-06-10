import { useState, useEffect, useRef } from 'react';
import type { NewsItem } from '../types';
import { triggerSummarizeOne, getNewsItem, triggerTake } from '../api/client';
import Comments from './Comments';
import RelatedArticles from './RelatedArticles';
import { stripHtml, estimateReadingTime, sanitizeHtml, formatTime } from '../utils/newsFormat';

const CAT_NAMES: Record<string, string> = {
  ai: 'AI', tech: '科技', news: '新闻', finance: '财经',
  entertainment: '娱乐', stocks: '股票', funds: '基金', energy: '新能源',
  general: '综合',
};
const CAT_COLORS: Record<string, string> = {
  ai: 'bg-purple-100 text-purple-600', tech: 'bg-emerald-100 text-emerald-600',
  news: 'bg-blue-100 text-blue-600', finance: 'bg-amber-100 text-amber-600',
  entertainment: 'bg-pink-100 text-pink-600',
  stocks: 'bg-rose-100 text-rose-600', funds: 'bg-yellow-100 text-yellow-700',
  energy: 'bg-green-100 text-green-600',
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
  const [showShare, setShowShare] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [ttsSpeed, setTtsSpeed] = useState(1);
  const [readerContent, setReaderContent] = useState<string | null>(null);
  const [readerLoading, setReaderLoading] = useState(false);
  const [readerDark, setReaderDark] = useState(false);
  const [sourceView, setSourceView] = useState<'iframe' | null>(null);
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const shareRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setCurrentItem(item); setTranslated(null); setTakeError(false); setError(null); setReaderContent(null); setSourceView(null); if (screenshotUrl) { URL.revokeObjectURL(screenshotUrl); setScreenshotUrl(null); } }, [item]);

  // Share dropdown: click outside to close
  useEffect(() => {
    if (!showShare) return;
    function handleClick(e: MouseEvent) {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) {
        setShowShare(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showShare]);

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
      setError('AI 小编生成失败，请稍后重试');
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
    } catch {
      setError('AI 摘要生成失败，请稍后重试');
    }
    setSummarizing(false);
  }

  async function handleRelatedSelect(newsId: number) {
    try {
      const item = await getNewsItem(newsId);
      if (item) {
        setCurrentItem(item);
        document.title = `${item.title} - News`;
        window.history.replaceState({}, '', `/share/${newsId}`);
      }
    } catch {
      setError('相关推荐加载失败');
    }
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
      } else {
        setError('翻译失败，请稍后重试');
      }
    } catch {
      setError('翻译失败，请稍后重试');
    }
    setTranslating(false);
  }

  async function handlePlay() {
    if (!currentItem) return;
    if (speechSynthesis.speaking) {
      speechSynthesis.cancel();
      setPlaying(false);
      return;
    }
    const text = readerContent
      ? stripHtml(readerContent)
      : stripHtml(currentItem.ai_summary || currentItem.title);
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = currentItem.source_lang === 'zh' ? 'zh-CN' : 'en-US';
    utterance.rate = ttsSpeed;
    utterance.onend = () => setPlaying(false);
    utterance.onerror = () => setPlaying(false);
    setPlaying(true);
    speechSynthesis.speak(utterance);
  }

  async function handleReadFull() {
    if (!currentItem) return;
    if (readerContent) { setReaderContent(null); return; }
    setSourceView(null);
    setReaderLoading(true);
    try {
      const res = await fetch(`/api/news/${currentItem.id}/content`);
      const data = await res.json();
      if (res.ok && data.content) {
        setReaderContent(data.content);
      } else {
        setError(data.error || '阅读全文加载失败');
      }
    } catch {
      setError('阅读全文加载失败');
    }
    setReaderLoading(false);
  }

  async function handleScreenshot() {
    if (!currentItem) return;
    if (screenshotUrl) { URL.revokeObjectURL(screenshotUrl); setScreenshotUrl(null); return; }
    setScreenshotLoading(true);
    try {
      const res = await fetch(`/api/screenshot?url=${encodeURIComponent(currentItem.url)}`);
      if (res.ok) {
        const blob = await res.blob();
        setScreenshotUrl(URL.createObjectURL(blob));
      } else {
        setError('截图失败，请稍后重试');
      }
    } catch {
      setError('截图失败，请稍后重试');
    }
    setScreenshotLoading(false);
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('复制失败，请检查浏览器权限');
    }
  }

  if (!currentItem) return null;

  const itemId = currentItem.id;
  const cat = currentItem.category || 'general';
  const raw = (currentItem.published_at || currentItem.created_at || '');
  const date = formatTime(raw);
  const shareUrl = `${window.location.origin}/share/${itemId}`;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-content bg-white rounded-lg p-8 w-full max-w-[640px] max-h-[85vh] border border-gray-200 shadow-xl animate-[slideUp_0.25s_ease] relative overflow-y-auto">
        <button className="absolute top-4 right-4 w-9 h-9 rounded-full bg-gray-100 border border-gray-200 text-gray-400 cursor-pointer text-base flex items-center justify-center hover:bg-gray-200 hover:text-gray-600 transition" onClick={onClose}>✕</button>

        <div className="flex gap-2.5 items-center mb-4">
          <span className={`px-2.5 py-1 rounded-full text-[12px] font-semibold ${CAT_COLORS[cat] || 'bg-gray-100 text-gray-500'}`}>{CAT_NAMES[cat] || cat}</span>
          <span className="text-[13px] text-gray-400">{currentItem.source_name}</span>
        </div>

        <h2 className="text-[22px] font-bold leading-snug mb-3 text-gray-900">{currentItem.title}</h2>

        <div className="flex gap-4 text-[13px] text-gray-400 mb-5 items-center">
          <span>{date}</span>
          <span>{currentItem.source_lang === 'zh' ? '中文' : '英文'}</span>
          <button className="hover:text-indigo-500 transition cursor-pointer" onClick={handlePlay}>
            {playing ? '停止播报' : '播报'}
          </button>
          <select className="text-[11px] bg-transparent border border-gray-200 rounded px-1 py-0.5 cursor-pointer" value={ttsSpeed} onChange={e => setTtsSpeed(Number(e.target.value))}>
            <option value={0.5}>0.5x</option>
            <option value={0.75}>0.75x</option>
            <option value={1}>1x</option>
            <option value={1.25}>1.25x</option>
            <option value={1.5}>1.5x</option>
          </select>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-600 flex items-center justify-between gap-3">
            <span>{error}</span>
            <button className="text-red-400 hover:text-red-600" onClick={() => setError(null)}>关闭</button>
          </div>
        )}

        <style>{`@keyframes fsi{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}.fi{animation:fsi .2s ease-out}`}</style>
        <div key={currentItem.id} className="fi">
        {currentItem.ai_summary ? (
          <div className="bg-gradient-to-r from-indigo-50 to-purple-50 px-5 py-4 rounded-lg mb-5 border-l-[3px] border-indigo-500">
            <div className="font-semibold text-[13px] text-indigo-500 mb-2">AI 摘要</div>
            <p className="text-sm text-gray-600 leading-relaxed">{stripHtml(currentItem.ai_summary)}</p>
          </div>
        ) : (
          <button type="button" className="mb-4 px-4 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 hover:border-indigo-500 hover:text-indigo-500 transition disabled:opacity-40" onClick={handleSummarize} disabled={summarizing}>
            {summarizing ? '生成中...' : '生成 AI 摘要'}
          </button>
        )}

        {currentItem.ai_take ? (
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-5 py-4 rounded-lg mb-5 border-l-[3px] border-amber-400">
            <div className="font-semibold text-[13px] text-amber-600 mb-2">AI 小编</div>
            <p className="text-sm text-amber-700 italic">{currentItem.ai_take}</p>
          </div>
        ) : currentItem.ai_summary ? (
          <div className="mb-4">
            {takeError && <p className="text-[12px] text-red-400 mb-1">生成失败，可重试</p>}
            <button type="button" className="px-4 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 hover:border-amber-500 hover:text-amber-500 transition disabled:opacity-40" onClick={handleTake} disabled={taking}>
              {taking ? 'AI 思考中...' : '生成 AI 吐槽'}
            </button>
          </div>
        ) : null}

        {currentItem.source_lang !== 'zh' && (
          <button type="button" className="mb-4 ml-2 px-4 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 hover:border-emerald-500 hover:text-emerald-500 transition disabled:opacity-40" onClick={handleTranslate} disabled={translating}>
            {translating ? '翻译中...' : '翻译为中文'}
          </button>
        )}

        {translated && (
          <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-5 py-4 rounded-lg mb-5 border-l-[3px] border-emerald-500">
            <div className="font-semibold text-[13px] text-emerald-600 mb-2">中文翻译</div>
            <p className="text-sm text-gray-600 leading-relaxed">{translated.description}</p>
          </div>
        )}

        {currentItem!.description && !readerContent && <div className="text-sm text-gray-600 leading-relaxed mb-4 news-content" dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentItem!.description) }} />}

        {readerContent && (
          <div className={`${readerDark ? 'bg-gray-900 text-gray-100 reader-dark' : 'bg-white text-gray-900'} rounded-xl p-8 my-4 mx-auto border ${readerDark ? 'border-gray-700' : 'border-gray-100'}`}>
            <div className="flex items-center justify-between mb-4">
              <span className="text-sm text-gray-400">{estimateReadingTime(readerContent)} 分钟阅读</span>
              <div className="flex gap-2">
                <button className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 cursor-pointer" onClick={() => setReaderDark(!readerDark)}>
                  {readerDark ? '白天' : '夜间'}
                </button>
                <button className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-600 hover:bg-gray-200 cursor-pointer" onClick={() => setReaderContent(null)}>✕ 关闭</button>
              </div>
            </div>
            <div className="leading-[1.9] break-words reader-body" style={{ fontSize: '20px', color: readerDark ? '#d1d5db' : '#1f2937' }} dangerouslySetInnerHTML={{ __html: readerContent }} />
            <style>{`.reader-body h1,.reader-body h2,.reader-body h3,.reader-body h4{font-weight:700;margin:1.2em 0 .6em;line-height:1.3}.reader-body h1{font-size:1.6em}.reader-body h2{font-size:1.4em}.reader-body h3{font-size:1.2em}.reader-body p{margin:.8em 0;line-height:1.9}.reader-body img{max-width:100%;height:auto;border-radius:8px;margin:16px 0}.reader-body a{color:#6366f1;text-decoration:underline}.reader-body ul,.reader-body ol{padding-left:1.5em;margin:.8em 0}.reader-body li{margin:.3em 0}.reader-body blockquote{border-left:3px solid #6366f1;margin:1em 0;padding:.5em 1em;background:rgba(99,102,241,.05);border-radius:0 8px 8px 0}.reader-body pre{background:#f3f4f6;padding:1em;border-radius:8px;overflow-x:auto;font-size:.9em;line-height:1.5;margin:1em 0}.reader-body code{font-family:ui-monospace,monospace;font-size:.9em;background:#f3f4f6;padding:2px 5px;border-radius:3px}.reader-body pre code{background:none;padding:0}.reader-body table{border-collapse:collapse;width:100%;margin:1em 0}.reader-body th,.reader-body td{border:1px solid #d1d5db;padding:8px 12px;text-align:left}.reader-body th{background:#f9fafb;font-weight:600}.reader-body hr{border:none;border-top:1px solid #e5e7eb;margin:1.5em 0}.reader-body figure{margin:1em 0;text-align:center}.reader-body figcaption{font-size:.85em;color:#9ca3af;margin-top:.3em}.reader-body iframe{max-width:100%;border-radius:8px;margin:1em 0}.reader-dark blockquote{background:rgba(99,102,241,.1)}.reader-dark pre,.reader-dark code{background:#374151}.reader-dark th{background:#1f2937}.reader-dark th,.reader-dark td{border-color:#4b5563}`}</style>
          </div>
        )}

        <style>{`.news-content img { max-width: 100%; height: auto; border-radius: 8px; } .news-content a { color: #6366f1; text-decoration: underline; }`}</style>

        <div className="mt-5 pt-4 border-t border-gray-200">
          <Comments newsId={currentItem!.id} token={token} />
        </div>

        {sourceView && (
          <div className="my-4 rounded-xl overflow-hidden border border-gray-200">
            <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
              <span className="text-xs text-gray-500 truncate max-w-[50%]">{currentItem!.url}</span>
              <div className="flex gap-2">
                <button className="text-xs px-2 py-1 rounded bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 cursor-pointer" onClick={handleScreenshot} disabled={screenshotLoading}>{screenshotLoading ? '截图中...' : '截图'}</button>
                <button className="text-xs px-2 py-1 rounded bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 cursor-pointer" onClick={() => onOpenUrl(currentItem!.url)}>新标签打开</button>
                <button className="text-xs px-2 py-1 rounded bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 cursor-pointer" onClick={() => { if (screenshotUrl) { URL.revokeObjectURL(screenshotUrl); setScreenshotUrl(null); } setSourceView(null); }}>✕ 关闭</button>
              </div>
            </div>
            {screenshotUrl ? (
              <img src={screenshotUrl} alt="screenshot" className="w-full" />
            ) : (
              <iframe
                src={currentItem!.url}
                className="w-full h-[75vh] bg-white rounded-b-xl"
                sandbox="allow-scripts allow-same-origin allow-forms"
                title="source"
              />
            )}
          </div>
        )}

        <RelatedArticles newsId={itemId} title={currentItem!.title} onSelect={handleRelatedSelect} />
        </div>

        <div className="flex gap-3 mt-4 flex-wrap">
          <button className="px-5 py-2.5 bg-indigo-500 text-white rounded-lg text-[13px] font-medium hover:bg-indigo-600 transition" onClick={() => { setSourceView(sourceView ? null : 'iframe'); setReaderContent(null); }}>
            {sourceView ? '关闭原站' : '原站浏览'}
          </button>
          <button className="px-5 py-2.5 rounded-lg text-[13px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 hover:border-indigo-500 hover:text-indigo-500 transition disabled:opacity-40" onClick={handleReadFull} disabled={readerLoading}>
            {readerLoading ? '加载中...' : readerContent ? '关闭阅读' : '阅读全文'}
          </button>
          <button className="px-5 py-2.5 rounded-lg text-[13px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 transition" onClick={copyLink}>
            {copied ? '✓ 已复制' : '⇋ 复制链接'}
          </button>
          <div className="relative" ref={shareRef}>
            <button className="px-5 py-2.5 rounded-lg text-[13px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 transition" onClick={() => setShowShare(!showShare)}>↗ 分享到</button>
            {showShare && (
              <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px] z-10 animate-[slideUp_0.15s_ease]">
                <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(currentItem!.title)}&url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noopener noreferrer" className="block px-4 py-2 text-[13px] text-gray-700 hover:bg-gray-50" onClick={() => setShowShare(false)}>𝕏 Twitter</a>
                <a href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(currentItem!.title)}`} target="_blank" rel="noopener noreferrer" className="block px-4 py-2 text-[13px] text-gray-700 hover:bg-gray-50" onClick={() => setShowShare(false)}>✈ Telegram</a>
                <a href={`https://wa.me/?text=${encodeURIComponent(currentItem!.title + ' ' + shareUrl)}`} target="_blank" rel="noopener noreferrer" className="block px-4 py-2 text-[13px] text-gray-700 hover:bg-gray-50" onClick={() => setShowShare(false)}>WhatsApp</a>
                <button onClick={() => { copyLink(); setShowShare(false); }} className="block w-full text-left px-4 py-2 text-[13px] text-gray-700 hover:bg-gray-50">复制链接</button>
              </div>
            )}
          </div>
          <button className="px-5 py-2.5 rounded-lg text-[13px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 transition" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

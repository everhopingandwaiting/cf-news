import { useState, useEffect, useRef, useCallback } from 'react';
import type { CredibilityReport, NewsItem, PerspectiveReport, NewsEntity, RelatedArticle } from '../types';
import { addReadLater, getCredibility, getPerspectives, getEntities, triggerSummarizeOne, getNewsItem, triggerTake, triggerIllustration, getRelatedArticles } from '../api/client';
import Comments from './Comments';
import { stripHtml, estimateReadingTime, sanitizeHtml, formatTime, CAT_NAMES, CAT_COLORS } from '../utils/newsFormat';


/* ═══════════════════════════════════════════════════════
   Sub-Components
   ═══════════════════════════════════════════════════════ */

function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg className="animate-spin inline-block" width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v3a5 5 0 00-5 5H4z" />
    </svg>
  );
}

function SkeletonBlock({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2.5 py-1 ${className}`} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className="h-3 rounded-full bg-gradient-to-r from-gray-200 via-gray-100 to-gray-200 bg-[length:200%_100%]"
          style={{ width: i === 0 ? '75%' : i === lines - 1 ? '55%' : '100%', animation: `shimmer 1.5s ease-in-out ${i * 80}ms infinite` }}
        />
      ))}
    </div>
  );
}

function LazySection({ children, placeholder }: { children: React.ReactNode; placeholder?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (visible) return;
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) { setVisible(true); obs.disconnect(); } },
      { rootMargin: '200px' }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, [visible]);
  return <div ref={ref}>{visible ? children : (placeholder ?? <div className="h-16" />)}</div>;
}

function ErrorBanner({ message, onRetry, onDismiss }: { message: string; onRetry?: () => void; onDismiss: () => void }) {
  return (
    <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-600 flex items-center gap-3" role="alert">
      <span className="text-red-400 shrink-0 text-base">⚠</span>
      <span className="flex-1 leading-snug">{message}</span>
      {onRetry && (
        <button
          className="shrink-0 text-[12px] font-medium px-3 py-1.5 rounded-lg bg-white border border-red-200 text-red-500 hover:bg-red-100 active:scale-[0.97] transition-all min-h-[32px]"
          onClick={onRetry}
          aria-label="重试"
        >
          重试
        </button>
      )}
      <button className="shrink-0 text-red-400 hover:text-red-600 p-1 min-w-[32px] min-h-[32px] flex items-center justify-center" onClick={onDismiss} aria-label="关闭错误提示">✕</button>
    </div>
  );
}


/* ═══════════════════════════════════════════════════════
   Global Animation Styles
   ═══════════════════════════════════════════════════════ */

const GLOBAL_STYLES = `
@keyframes shimmer{0%{background-position:200% 0}100%{background-position:-200% 0}}
@keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}}
@keyframes slideUp{from{opacity:0;transform:translateY(16px)}to{opacity:1;transform:translateY(0)}}
@keyframes fadeIn{from{opacity:0}to{opacity:1}}
@keyframes fadeSlideIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
.news-content img{max-width:100%;height:auto;border-radius:8px}
.news-content a{color:#6366f1;text-decoration:underline}
.news-detail-btn{@apply min-h-[44px] min-w-[44px] active:scale-[0.97] transition-all duration-150}
`;


/* ═══════════════════════════════════════════════════════
   Types
   ═══════════════════════════════════════════════════════ */

interface Props {
  item: NewsItem | null;
  token: string | null;
  onClose: () => void;
  onOpenUrl: (url: string) => void;
  onSummaryGenerated: () => void;
}


/* ═══════════════════════════════════════════════════════
   Main Component
   ═══════════════════════════════════════════════════════ */

export default function NewsDetailModal({ item, token, onClose, onOpenUrl, onSummaryGenerated }: Props) {

  /* ─── Existing State ─── */
  const [summarizing, setSummarizing] = useState(false);
  const [taking, setTaking] = useState(false);
  const [takeError, setTakeError] = useState(false);
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
  const [credibility, setCredibility] = useState<CredibilityReport | null>(null);
  const [credLoading, setCredLoading] = useState(false);
  const [credError, setCredError] = useState<string | null>(null);
  const [perspectives, setPerspectives] = useState<PerspectiveReport | null>(null);
  const [perspectiveLoading, setPerspectiveLoading] = useState(false);
  const [perspError, setPerspError] = useState<string | null>(null);
  const [entities, setEntities] = useState<NewsEntity[] | null>(null);
  const [entityLoading, setEntityLoading] = useState(false);
  const [entError, setEntError] = useState<string | null>(null);
  const [savedLater, setSavedLater] = useState(false);
  const [ttsLoading, setTtsLoading] = useState(false);
  const [illustrating, setIllustrating] = useState(false);
  const [illustrationUrl, setIllustrationUrl] = useState<string | null>(null);
  const [relatedArticles, setRelatedArticles] = useState<RelatedArticle[]>([]);
  const [relatedLoading, setRelatedLoading] = useState(true);
  const [relatedExpanded, setRelatedExpanded] = useState(false);
  /* ─── New State ─── */
  const [isMobile, setIsMobile] = useState(false);
  const [analysisTab, setAnalysisTab] = useState<'credibility' | 'perspectives' | 'entities'>('credibility');

  /* ─── Refs ─── */
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const shareRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const touchStartYRef = useRef(0);
  const sheetDragging = useRef(false);

  /* ─── Mobile Detection ─── */
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)');
    setIsMobile(mq.matches);
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  /* ─── Body Scroll Lock (mobile) ─── */
  useEffect(() => {
    if (isMobile && item) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [isMobile, item]);

  /* ─── Swipe-to-Dismiss (drag handle only) ─── */
  const handleHandleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartYRef.current = e.touches[0].clientY;
    sheetDragging.current = true;
    if (sheetRef.current) sheetRef.current.style.transition = 'none';
  }, []);

  const handleHandleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!sheetDragging.current || !sheetRef.current) return;
    const dy = e.touches[0].clientY - touchStartYRef.current;
    if (dy > 0) {
      sheetRef.current.style.transform = `translateY(${dy}px)`;
      sheetRef.current.style.opacity = String(1 - Math.min(dy / 400, 0.4));
    }
  }, []);

  const handleHandleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!sheetRef.current) return;
    sheetDragging.current = false;
    const dy = e.changedTouches[0].clientY - touchStartYRef.current;
    if (dy > 120) {
      onClose();
    } else {
      sheetRef.current.style.transform = '';
      sheetRef.current.style.opacity = '';
      sheetRef.current.style.transition = 'transform 0.3s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.3s ease';
    }
  }, [onClose]);

  /* ─── Existing Effects ─── */
  useEffect(() => {
    setCurrentItem(item);
    setTranslated(null);
    setTakeError(false);
    setError(null);
    setReaderContent(null);
    setSourceView(null);
    setCredibility(null);
    setPerspectives(null);
    setEntities(null);
    setCredError(null);
    setPerspError(null);
    setEntError(null);
    setSavedLater(false);
    setIllustrationUrl(item?.ai_illustration || null);
    setRelatedArticles([]);
    setRelatedLoading(true);
    setRelatedExpanded(false);
    if (screenshotUrl) { URL.revokeObjectURL(screenshotUrl); setScreenshotUrl(null); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);

  useEffect(() => {
    if (!showShare) return;
    function handleClick(e: MouseEvent) {
      if (shareRef.current && !shareRef.current.contains(e.target as Node)) setShowShare(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showShare]);

  /* ─── Existing Handlers ─── */
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

  async function handleIllustration() {
    if (!currentItem || illustrating) return;
    setIllustrating(true);
    try {
      const data = await triggerIllustration(currentItem.id);
      if (data.image_url) {
        setIllustrationUrl(data.image_url);
      } else {
        setError('AI 插画生成失败');
      }
    } catch {
      setError('AI 插画生成失败，请稍后重试');
    }
    setIllustrating(false);
  }

  async function handleSummarize() {
    if (!currentItem) return;
    setSummarizing(true);
    try {
      await triggerSummarizeOne(currentItem.id);
      const updated = await getNewsItem(currentItem.id);
      if (updated) setCurrentItem(updated);
      onSummaryGenerated();
    } catch {
      setError('AI 摘要生成失败，请稍后重试');
    }
    setSummarizing(false);
  }

  async function handleRelatedSelect(newsId: number) {
    try {
      const selected = await getNewsItem(newsId);
      if (selected) {
        setCurrentItem(selected);
        setIllustrationUrl(selected.ai_illustration || null);
        setIllustrating(false);
        document.title = `${selected.title} - News`;
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

  function handlePlay() {
    if (!currentItem) return;
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
      setPlaying(false);
      return;
    }
    if ('speechSynthesis' in window && speechSynthesis.speaking) {
      speechSynthesis.cancel();
      setPlaying(false);
      return;
    }
    const text = readerContent
      ? stripHtml(readerContent)
      : stripHtml(currentItem.ai_summary || currentItem.title);
    if (!text.trim()) {
      setError('没有可播报的内容，请先生成 AI 摘要');
      return;
    }
    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = currentItem.source_lang === 'zh' ? 'zh-CN' : 'en-US';
      utterance.rate = ttsSpeed;
      utterance.onend = () => setPlaying(false);
      utterance.onerror = () => { setPlaying(false); playTtsApi(text); };
      try {
        setPlaying(true);
        speechSynthesis.speak(utterance);
        return;
      } catch {
        speechSynthesis.cancel();
      }
    }
    playTtsApi(text);
  }

  async function playTtsApi(text: string) {
    try {
      setTtsLoading(true);
      setPlaying(true);
      const res = await fetch(`/api/tts?text=${encodeURIComponent(text.slice(0, 500))}`);
      if (!res.ok) throw new Error('TTS failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { setPlaying(false); audioRef.current = null; URL.revokeObjectURL(url); };
      audio.onerror = () => { setPlaying(false); audioRef.current = null; URL.revokeObjectURL(url); setError('语音播报出错'); };
      await audio.play();
    } catch {
      setPlaying(false);
      setError('语音播报失败');
    } finally {
      setTtsLoading(false);
    }
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
    } catch {
      setError('复制失败，请检查浏览器权限');
    }
  }

  async function handleCredibility() {
    if (!currentItem) return;
    if (credibility) { setCredibility(null); return; }
    setCredLoading(true);
    setCredError(null);
    try {
      setCredibility(await getCredibility(currentItem.id));
    } catch {
      setCredError('可信度分析加载失败');
    }
    setCredLoading(false);
  }

  async function handlePerspectives() {
    if (!currentItem) return;
    if (perspectives) { setPerspectives(null); return; }
    setPerspectiveLoading(true);
    setPerspError(null);
    try {
      setPerspectives(await getPerspectives(currentItem.id));
    } catch {
      setPerspError('观点光谱生成失败，可能缺少同事件多来源报道');
    }
    setPerspectiveLoading(false);
  }

  async function handleEntities() {
    if (!currentItem) return;
    if (entities) { setEntities(null); return; }
    setEntityLoading(true);
    setEntError(null);
    try {
      setEntities(await getEntities(currentItem.id));
    } catch {
      setEntError('实体提取加载失败');
    }
    setEntityLoading(false);
  }

  async function handleSaveLater() {
    if (!currentItem) return;
    if (!token) { setError('请先登录以使用稍后读'); return; }
    try {
      await addReadLater(currentItem.id);
      setSavedLater(true);
    } catch {
      setError('加入稍后读失败');
    }
  }

  /* ─── Auto-load analysis on item change ─── */
  useEffect(() => {
    if (!currentItem) return;
    handleCredibility();
    handlePerspectives();
    handleEntities();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem]);

  /* ─── Fetch related articles ─── */
  useEffect(() => {
    if (!currentItem) return;
    let cancelled = false;
    setRelatedLoading(true);
    getRelatedArticles(currentItem.id)
      .then(data => { if (!cancelled) setRelatedArticles(data.related || []); })
      .catch(() => { if (!cancelled) setRelatedArticles([]); })
      .finally(() => { if (!cancelled) setRelatedLoading(false); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem]);

  /* ─── Computed ─── */
  if (!currentItem) return null;

  const itemId = currentItem.id;
  const cat = currentItem.category || 'general';
  const raw = (currentItem.published_at || currentItem.created_at || '');
  const date = formatTime(raw);
  const shareUrl = `${window.location.origin}/share/${itemId}`;

  /* ─── Error retry mapping ─── */
  function getErrorRetry(): (() => void) | undefined {
    if (!error) return undefined;
    if (error.includes('摘要')) return handleSummarize;
    if (error.includes('小编')) return handleTake;
    if (error.includes('插画')) return handleIllustration;
    if (error.includes('翻译')) return handleTranslate;
    if (error.includes('可信度')) return handleCredibility;
    if (error.includes('观点')) return handlePerspectives;
    if (error.includes('实体')) return handleEntities;
    if (error.includes('阅读全文')) return handleReadFull;
    if (error.includes('截图')) return handleScreenshot;
    return undefined;
  }

  /* ═══════════════════════════════════════════════════════
     Render
     ═══════════════════════════════════════════════════════ */
  return (
    <>
      <style>{GLOBAL_STYLES}</style>

      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-[60] ${isMobile ? 'bg-black/50' : 'bg-black/40 backdrop-blur-sm flex items-center justify-center'}`}
        style={{ animation: 'fadeIn 0.15s ease' }}
        onClick={e => { if (e.target === e.currentTarget) onClose(); }}
        aria-modal="true"
        role="dialog"
      >
        {/* ─── Modal Container ─── */}
        <div
          ref={sheetRef}
          className={
            isMobile
              ? 'absolute bottom-0 left-0 right-0 bg-white w-full shadow-2xl flex flex-col'
              : 'bg-white rounded-lg w-full max-w-[900px] border border-gray-200 shadow-xl flex flex-col'
          }
          style={isMobile
            ? {
                maxHeight: 'min(90vh, calc(100vh - env(safe-area-inset-top, 0px)))',
                borderRadius: '16px 16px 0 0',
                paddingBottom: 'env(safe-area-inset-bottom, 0px)',
                animation: 'sheetUp 0.35s cubic-bezier(0.32, 0.72, 0, 1)',
              }
            : {
                maxHeight: '92vh',
                animation: 'slideUp 0.25s ease',
              }
          }
        >
          {/* ─── Drag Handle (mobile only) ─── */}
          {isMobile && (
            <div
              className="flex justify-center pt-2.5 pb-1.5 cursor-grab active:cursor-grabbing select-none touch-none"
              onTouchStart={handleHandleTouchStart}
              onTouchMove={handleHandleTouchMove}
              onTouchEnd={handleHandleTouchEnd}
              aria-label="拖拽关闭"
            >
              <div className="w-10 h-1 rounded-full bg-gray-300" />
            </div>
          )}

          {/* ─── Sticky Header ─── */}
          <div className="sticky top-0 z-10 bg-white/95 backdrop-blur-sm border-b border-gray-100 px-4 sm:px-6 py-3 flex items-center justify-between shrink-0 rounded-t-lg sm:rounded-t-lg">
            <div className="flex gap-2 items-center min-w-0 flex-1">
              <span className={`shrink-0 px-2.5 py-0.5 rounded-full text-[11px] font-semibold ${CAT_COLORS[cat] || 'bg-gray-100 text-gray-500'}`}>
                {CAT_NAMES[cat] || cat}
              </span>
              <span className="text-[13px] text-gray-400 truncate">{currentItem.source_name}</span>
            </div>
            <button
              className="shrink-0 w-9 h-9 rounded-full bg-gray-100 border border-gray-200 text-gray-400 text-sm flex items-center justify-center hover:bg-gray-200 hover:text-gray-600 active:scale-[0.92] transition-all ml-3 news-detail-btn"
              onClick={onClose}
              aria-label="关闭"
            >
              ✕
            </button>
          </div>

          {/* ─── Scrollable Content ─── */}
          <div className="overflow-y-auto flex-1 overscroll-contain">
            <div className="px-3 sm:px-5 py-2 sm:py-3">

              {/* ─── Title ─── */}
              <h2 className="text-[20px] font-bold leading-snug mb-2.5 text-gray-900">{currentItem.title}</h2>

              {/* ─── Meta Row ─── */}
              <div className="flex gap-3 text-[13px] text-gray-400 mb-2 items-center flex-wrap">
                <span>{date}</span>
                <span className="text-gray-300">·</span>
                <span>{currentItem.source_lang === 'zh' ? '中文' : '英文'}</span>
                <span className="text-gray-300">·</span>
                <button
                  className="hover:text-indigo-500 transition cursor-pointer disabled:opacity-40 min-h-[32px] active:scale-[0.97]"
                  onClick={handlePlay}
                  disabled={ttsLoading}
                  aria-label={playing ? '停止播报' : '播报'}
                >
                  {ttsLoading ? <span className="inline-flex items-center gap-1"><Spinner size={12} /> 加载中</span> : playing ? '⏹ 停止' : '🔊 播报'}
                </button>
                <select
                  className="text-[11px] bg-transparent border border-gray-200 rounded px-1.5 py-0.5 cursor-pointer min-h-[28px]"
                  value={ttsSpeed}
                  onChange={e => setTtsSpeed(Number(e.target.value))}
                  aria-label="播报速度"
                >
                  <option value={0.5}>0.5x</option>
                  <option value={0.75}>0.75x</option>
                  <option value={1}>1x</option>
                  <option value={1.25}>1.25x</option>
                  <option value={1.5}>1.5x</option>
                </select>
              </div>

              {/* ─── Error Banner ─── */}
              {error && (
                <ErrorBanner
                  message={error}
                  onRetry={getErrorRetry()}
                  onDismiss={() => setError(null)}
                />
              )}

              {/* ─── Content Area (animated) ─── */}
              <div key={currentItem.id} style={{ animation: 'fadeSlideIn 0.2s ease-out' }}>

                {/* ─── AI Insights Group ─── */}
                {(currentItem.ai_summary || currentItem.ai_take || translated || illustrationUrl || currentItem.source_lang !== 'zh') && (
                  <div className="mb-3 rounded-xl border border-gray-100 bg-gray-50/50 p-3 space-y-2">
                    <div className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">AI 洞察</div>

                    {/* AI Summary */}
                    {currentItem.ai_summary ? (
                      <div className="bg-gradient-to-r from-indigo-50 to-purple-50 px-4 py-3 rounded-lg border-l-[3px] border-indigo-500">
                        <div className="font-semibold text-[12px] text-indigo-500 mb-1.5">AI 摘要</div>
                        <p className="text-[13px] text-gray-600 leading-relaxed">{stripHtml(currentItem.ai_summary)}</p>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="px-3.5 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-indigo-500 hover:text-indigo-500 active:scale-[0.97] transition-all disabled:opacity-40 news-detail-btn"
                        onClick={handleSummarize}
                        disabled={summarizing}
                      >
                        {summarizing ? <span className="inline-flex items-center gap-1.5"><Spinner size={12} /> 生成中...</span> : '✨ 生成 AI 摘要'}
                      </button>
                    )}

                    {/* AI Take */}
                    {currentItem.ai_take ? (
                      <div className="bg-gradient-to-r from-amber-50 to-orange-50 px-4 py-3 rounded-lg border-l-[3px] border-amber-400">
                        <div className="font-semibold text-[12px] text-amber-600 mb-1.5">AI 小编</div>
                        <p className="text-[13px] text-amber-700 italic leading-relaxed">{currentItem.ai_take}</p>
                      </div>
                    ) : currentItem.ai_summary ? (
                      <div>
                        {takeError && <p className="text-[11px] text-red-400 mb-1">生成失败，可重试</p>}
                        <button
                          type="button"
                          className="px-3.5 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-amber-500 hover:text-amber-500 active:scale-[0.97] transition-all disabled:opacity-40 news-detail-btn"
                          onClick={handleTake}
                          disabled={taking}
                        >
                          {taking ? <span className="inline-flex items-center gap-1.5"><Spinner size={12} /> AI 思考中...</span> : '🔥 AI 吐槽'}
                        </button>
                      </div>
                    ) : null}

                    {/* Translation */}
                    {translated ? (
                      <div className="bg-gradient-to-r from-emerald-50 to-teal-50 px-4 py-3 rounded-lg border-l-[3px] border-emerald-500">
                        <div className="font-semibold text-[12px] text-emerald-600 mb-1.5">中文翻译</div>
                        <p className="text-[13px] text-gray-600 leading-relaxed">{translated.description}</p>
                      </div>
                    ) : currentItem.source_lang !== 'zh' ? (
                      <button
                        type="button"
                        className="px-3.5 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-emerald-500 hover:text-emerald-500 active:scale-[0.97] transition-all disabled:opacity-40 news-detail-btn"
                        onClick={handleTranslate}
                        disabled={translating}
                      >
                        {translating ? <span className="inline-flex items-center gap-1.5"><Spinner size={12} /> 翻译中...</span> : '🌐 翻译为中文'}
                      </button>
                    ) : null}

                    {/* AI Illustration */}
                    {illustrationUrl ? (
                      <div className="rounded-lg overflow-hidden border border-gray-200">
                        <img
                          src={illustrationUrl}
                          alt="AI 插画"
                          className="w-full object-cover max-h-64"
                          loading="lazy"
                          style={{ aspectRatio: '16/9' }}
                        />
                        <div className="px-3 py-1.5 text-[11px] text-gray-400 bg-white flex items-center justify-between">
                          <span>🎨 AI 生成插画</span>
                          <button
                            className="hover:text-indigo-500 transition active:scale-[0.97] min-h-[28px]"
                            onClick={() => setIllustrationUrl(null)}
                            aria-label="关闭插画"
                          >
                            ✕ 关闭
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="px-3.5 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-purple-500 hover:text-purple-500 active:scale-[0.97] transition-all disabled:opacity-40 news-detail-btn"
                        onClick={handleIllustration}
                        disabled={illustrating}
                      >
                        {illustrating ? <span className="inline-flex items-center gap-1.5"><Spinner size={12} /> 生成中...</span> : '🎨 AI 插画'}
                      </button>
                    )}
                  </div>
                )}

                {/* No AI insights available — generate buttons */}
                {!currentItem.ai_summary && !currentItem.ai_take && !translated && !illustrationUrl && currentItem.source_lang === 'zh' && (
                  <div className="mb-5 rounded-xl border border-dashed border-gray-200 bg-gray-50/50 p-4 flex flex-wrap gap-2">
                    <button
                      type="button"
                      className="px-3.5 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-indigo-500 hover:text-indigo-500 active:scale-[0.97] transition-all disabled:opacity-40 news-detail-btn"
                      onClick={handleSummarize}
                      disabled={summarizing}
                    >
                      {summarizing ? <span className="inline-flex items-center gap-1.5"><Spinner size={12} /> 生成中...</span> : '✨ 生成 AI 摘要'}
                    </button>
                    <button
                      type="button"
                      className="px-3.5 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-purple-500 hover:text-purple-500 active:scale-[0.97] transition-all disabled:opacity-40 news-detail-btn"
                      onClick={handleIllustration}
                      disabled={illustrating}
                    >
                      {illustrating ? <span className="inline-flex items-center gap-1.5"><Spinner size={12} /> 生成中...</span> : '🎨 AI 插画'}
                    </button>
                  </div>
                )}

                {/* ─── Description / Content ─── */}
                {currentItem.description && !readerContent && (
                  <div className="mb-4 relative">
                    <div
                      className="text-sm text-gray-600 leading-relaxed news-content"
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(currentItem.description) }}
                    />
                  </div>
                )}

                {/* ─── Reader Mode ─── */}
                {readerContent && (
                  <div className={`${readerDark ? 'bg-gray-900 text-gray-100 reader-dark' : 'bg-white text-gray-900'} rounded-xl p-6 sm:p-8 my-4 mx-auto border ${readerDark ? 'border-gray-700' : 'border-gray-100'}`}>
                    <div className="flex items-center justify-between mb-4">
                      <span className="text-sm text-gray-400">{estimateReadingTime(readerContent)} 分钟阅读</span>
                      <div className="flex gap-2">
                        <button className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 active:scale-[0.97] transition-all min-h-[32px]" onClick={() => setReaderDark(!readerDark)}>
                          {readerDark ? '☀ 白天' : '🌙 夜间'}
                        </button>
                        <button className="text-xs px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600 hover:bg-gray-200 active:scale-[0.97] transition-all min-h-[32px]" onClick={() => setReaderContent(null)} aria-label="关闭阅读">
                          ✕ 关闭
                        </button>
                      </div>
                    </div>
                    <div
                      className="leading-[1.9] break-words reader-body"
                      style={{ fontSize: '20px', color: readerDark ? '#d1d5db' : '#1f2937' }}
                      dangerouslySetInnerHTML={{ __html: sanitizeHtml(readerContent) }}
                    />
                    <style>{`
                      .reader-body h1,.reader-body h2,.reader-body h3,.reader-body h4{font-weight:700;margin:1.2em 0 .6em;line-height:1.3}
                      .reader-body h1{font-size:1.6em}.reader-body h2{font-size:1.4em}.reader-body h3{font-size:1.2em}
                      .reader-body p{margin:.8em 0;line-height:1.9}
                      .reader-body img{max-width:100%;height:auto;border-radius:8px;margin:16px 0}
                      .reader-body a{color:#6366f1;text-decoration:underline}
                      .reader-body ul,.reader-body ol{padding-left:1.5em;margin:.8em 0}.reader-body li{margin:.3em 0}
                      .reader-body blockquote{border-left:3px solid #6366f1;margin:1em 0;padding:.5em 1em;background:rgba(99,102,241,.05);border-radius:0 8px 8px 0}
                      .reader-body pre{background:#f3f4f6;padding:1em;border-radius:8px;overflow-x:auto;font-size:.9em;line-height:1.5;margin:1em 0}
                      .reader-body code{font-family:ui-monospace,monospace;font-size:.9em;background:#f3f4f6;padding:2px 5px;border-radius:3px}
                      .reader-body pre code{background:none;padding:0}
                      .reader-body table{border-collapse:collapse;width:100%;margin:1em 0}
                      .reader-body th,.reader-body td{border:1px solid #d1d5db;padding:8px 12px;text-align:left}
                      .reader-body th{background:#f9fafb;font-weight:600}
                      .reader-body hr{border:none;border-top:1px solid #e5e7eb;margin:1.5em 0}
                      .reader-body figure{margin:1em 0;text-align:center}
                      .reader-body figcaption{font-size:.85em;color:#9ca3af;margin-top:.3em}
                      .reader-body iframe{max-width:100%;border-radius:8px;margin:1em 0}
                      .reader-dark blockquote{background:rgba(99,102,241,.1)}
                      .reader-dark pre,.reader-dark code{background:#374151}
                      .reader-dark th{background:#1f2937}.reader-dark th,.reader-dark td{border-color:#4b5563}
                    `}</style>
                  </div>
                )}

                {/* ─── AI Analysis Tabbed Section ─── */}
                {(credLoading || perspectiveLoading || entityLoading || credibility || perspectives || entities) && (
                  <div className="mb-3 rounded-lg border border-gray-200 overflow-hidden">
                    {/* Tab Bar */}
                    <div className="flex border-b border-gray-200 bg-gray-50">
                      {([
                        { key: 'credibility' as const, label: '🛡️ 可信度', color: 'emerald' },
                        { key: 'perspectives' as const, label: '🌈 观点光谱', color: 'indigo' },
                        { key: 'entities' as const, label: '🏷️ 关键实体', color: 'cyan' },
                      ]).map(tab => (
                        <button
                          key={tab.key}
                          className={`flex-1 px-3 py-2 text-[12px] font-medium transition-all active:scale-[0.97] ${
                            analysisTab === tab.key
                              ? `text-${tab.color}-700 bg-white border-b-2 border-${tab.color}-500`
                              : 'text-gray-500 hover:text-gray-700'
                          }`}
                          onClick={() => {
                            setAnalysisTab(tab.key);
                            if (tab.key === 'credibility' && !credibility && !credLoading) handleCredibility();
                            if (tab.key === 'perspectives' && !perspectives && !perspectiveLoading) handlePerspectives();
                            if (tab.key === 'entities' && !entities && !entityLoading) handleEntities();
                          }}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                      {/* Credibility Content */}
                      {analysisTab === 'credibility' && (
                        <>
                           {!credibility && credLoading && (
                             <div className="px-4 py-3 flex justify-center"><SkeletonBlock lines={3} /></div>
                           )}
                           {credError && (
                             <div className="p-4 text-[13px] text-red-500 text-center">{credError}</div>
                           )}
                           {!credibility && !credLoading && (
                            <div className="p-4 flex justify-center">
                              <button className="text-[12px] font-medium text-indigo-500 active:scale-[0.97] transition-transform" onClick={handleCredibility}>加载</button>
                            </div>
                          )}
                          {credibility && (
                            <div className="p-4" style={{ animation: 'fadeSlideIn 0.15s ease-out' }}>
                              <div className="mb-2 flex items-center justify-between gap-3">
                                <div className="text-[13px] font-semibold text-emerald-700">可信度参考</div>
                                <div className="text-[12px] font-semibold text-emerald-700">{credibility.score}/100</div>
                              </div>
                              <div className="flex flex-wrap gap-1.5 mb-3">
                                {credibility.signals.map(signal => (
                                  <span key={signal} className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">{signal}</span>
                                ))}
                              </div>
                              {credibility.articles.length > 0 && (
                                <div className="space-y-1.5">
                                  <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">相关报道</div>
                                  {credibility.articles.slice(0, 3).map(article => (
                                    <button
                                      key={article.id}
                                      className="block w-full rounded-md bg-emerald-50 px-2.5 py-2 text-left text-[12px] text-gray-700 hover:bg-emerald-100 active:scale-[0.98] transition-all min-h-[36px]"
                                      onClick={() => handleRelatedSelect(article.id)}
                                    >
                                      <span className="line-clamp-1">{article.title}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}

                      {/* Perspectives Content */}
                      {analysisTab === 'perspectives' && (
                        <>
                           {!perspectives && perspectiveLoading && (
                             <div className="px-4 py-3 flex justify-center"><SkeletonBlock lines={3} /></div>
                           )}
                           {perspError && (
                             <div className="p-4 text-[13px] text-red-500 text-center">{perspError}</div>
                           )}
                           {!perspectives && !perspectiveLoading && (
                            <div className="p-4 flex justify-center">
                              <button className="text-[12px] font-medium text-indigo-500 active:scale-[0.97] transition-transform" onClick={handlePerspectives}>加载</button>
                            </div>
                          )}
                          {perspectives && (
                            <div className="p-4" style={{ animation: 'fadeSlideIn 0.15s ease-out' }}>
                              <div className="mb-2 text-[13px] font-semibold text-indigo-700">观点光谱</div>
                              <p className="text-[13px] leading-relaxed text-gray-700 mb-3">{stripHtml(perspectives.perspective)}</p>
                              {perspectives.related.length > 0 && (
                                <div className="space-y-1.5">
                                  <div className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">相关来源</div>
                                  {perspectives.related.slice(0, 4).map(article => (
                                    <button
                                      key={article.id}
                                      className="block w-full rounded-md bg-indigo-50 px-2.5 py-2 text-left text-[12px] text-gray-700 hover:bg-indigo-100 active:scale-[0.98] transition-all min-h-[36px]"
                                      onClick={() => handleRelatedSelect(article.id)}
                                    >
                                      <span className="mr-2 text-gray-400">{article.source || '未知来源'}</span>
                                      <span className="line-clamp-1">{article.title}</span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}

                      {/* Entities Content */}
                      {analysisTab === 'entities' && (
                        <>
                           {!entities && entityLoading && (
                             <div className="px-4 py-3 flex justify-center"><SkeletonBlock lines={3} /></div>
                           )}
                           {entError && (
                             <div className="p-4 text-[13px] text-red-500 text-center">{entError}</div>
                           )}
                           {!entities && !entityLoading && (
                            <div className="p-4 flex justify-center">
                              <button className="text-[12px] font-medium text-indigo-500 active:scale-[0.97] transition-transform" onClick={handleEntities}>加载</button>
                            </div>
                          )}
                          {entities && (
                            <div className="p-4" style={{ animation: 'fadeSlideIn 0.15s ease-out' }}>
                              <div className="space-y-2">
                                {(['person', 'organization', 'location', 'number', 'event'] as const).map(type => {
                                  const items = entities.filter(e => e.type === type);
                                  if (items.length === 0) return null;
                                  const labels: Record<string, string> = { person: '👤 人物', organization: '🏢 组织', location: '📍 地点', number: '🔢 数字', event: '📌 事件' };
                                  const colors: Record<string, string> = { person: 'bg-blue-100 text-blue-700', organization: 'bg-purple-100 text-purple-700', location: 'bg-green-100 text-green-700', number: 'bg-amber-100 text-amber-700', event: 'bg-red-100 text-red-700' };
                                  return (
                                    <div key={type}>
                                      <div className="text-[11px] font-medium text-cyan-600 mb-1">{labels[type]}</div>
                                      <div className="flex flex-wrap gap-1.5">
                                        {items.map((ent, i) => (
                                          <span key={i} className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] ${colors[type]}`} title={ent.context || ent.value}>
                                            {ent.value}
                                            {ent.context && <span className="ml-1 opacity-60">· {ent.context}</span>}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </>
                      )}
                  </div>
                )}

                {/* ─── Source View (iframe / screenshot) ─── */}
                {sourceView && (
                  <div className="my-4 rounded-xl overflow-hidden border border-gray-200">
                    <div className="flex items-center justify-between px-4 py-2 bg-gray-50 border-b border-gray-200">
                      <span className="text-xs text-gray-500 truncate max-w-[50%]">{currentItem.url}</span>
                      <div className="flex gap-2">
                        <button
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 active:scale-[0.97] transition-all min-h-[32px]"
                          onClick={handleScreenshot}
                          disabled={screenshotLoading}
                        >
                          {screenshotLoading ? <span className="inline-flex items-center gap-1"><Spinner size={10} /> 截图中</span> : '📷 截图'}
                        </button>
                        <button
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 active:scale-[0.97] transition-all min-h-[32px]"
                          onClick={() => onOpenUrl(currentItem.url)}
                        >
                          ↗ 新标签
                        </button>
                        <button
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 active:scale-[0.97] transition-all min-h-[32px]"
                          onClick={() => { if (screenshotUrl) { URL.revokeObjectURL(screenshotUrl); setScreenshotUrl(null); } setSourceView(null); }}
                          aria-label="关闭原站"
                        >
                          ✕
                        </button>
                      </div>
                    </div>
                    {screenshotUrl ? (
                      <img src={screenshotUrl} alt="screenshot" className="w-full" loading="lazy" />
                    ) : (
                      <iframe
                        src={currentItem.url}
                        className="w-full h-[75vh] bg-white rounded-b-xl"
                        sandbox="allow-scripts allow-same-origin allow-forms"
                        title="source"
                      />
                    )}
                  </div>
                )}

                {/* ─── Related Articles ─── */}
                {(relatedLoading || relatedArticles.length > 0) && (
                  <div className="mt-5 pt-4 border-t border-gray-200">
                    {relatedLoading ? (
                      <SkeletonBlock lines={3} className="!py-0" />
                    ) : (
                      <>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-[13px] font-semibold text-gray-500">📎 相关推荐</span>
                          <span className="px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600 text-[11px] font-medium">{relatedArticles.length}</span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {relatedArticles.slice(0, relatedExpanded ? undefined : 4).map((article, i) => (
                            <button
                              key={article.id || i}
                              className="text-left p-3 rounded-lg border border-gray-100 bg-white hover:border-indigo-200 hover:bg-indigo-50/30 active:scale-[0.98] transition-all group"
                              onClick={() => {
                                const id = parseInt(article.id);
                                if (!isNaN(id)) handleRelatedSelect(id);
                              }}
                            >
                              {article.score > 0 && (
                                <div className="text-[11px] font-medium text-indigo-500 mb-1">{Math.round(article.score * 100)}% 匹配</div>
                              )}
                              <div className="text-[13px] font-medium text-gray-800 leading-snug line-clamp-2 group-hover:text-indigo-600 transition-colors">{article.text}</div>
                            </button>
                          ))}
                        </div>
                        {relatedArticles.length > 4 && !relatedExpanded && (
                          <button
                            className="mt-2 w-full text-center text-[12px] font-medium text-indigo-500 hover:text-indigo-600 py-2 active:scale-[0.97] transition-all"
                            onClick={() => setRelatedExpanded(true)}
                          >
                            查看更多 ({relatedArticles.length - 4})
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* ─── Lazy Comments ─── */}
                <LazySection
                  placeholder={
                    <div className="mt-5 pt-4 border-t border-gray-200">
                      <div className="h-4 w-20 bg-gray-200 rounded animate-pulse mb-3" />
                      <SkeletonBlock lines={2} className="!py-0" />
                    </div>
                  }
                >
                  <div className="mt-5 pt-4 border-t border-gray-200">
                    <Comments newsId={currentItem.id} token={token} />
                  </div>
                </LazySection>

              </div>
            </div>
          </div>

          {/* ─── Sticky Action Bar ─── */}
          <div
            className="sticky bottom-0 bg-white/95 backdrop-blur-sm border-t border-gray-100 px-3 sm:px-5 py-2 shrink-0"
            style={{ paddingBottom: 'max(12px, env(safe-area-inset-bottom, 0px))' }}
          >
            <div className="flex gap-2 flex-wrap items-center">
              {/* Primary actions */}
              <button
                className="px-3 py-1.5 bg-indigo-500 text-white rounded text-[12px] font-medium hover:bg-indigo-600 active:scale-[0.97] transition-all"
                onClick={() => { setSourceView(sourceView ? null : 'iframe'); setReaderContent(null); }}
                aria-label={sourceView ? '关闭原站' : '浏览原站'}
              >
                {sourceView ? '关闭原站' : '🔗 原站浏览'}
              </button>
              <button
                className="px-2 py-1.5 rounded text-[12px] font-medium border border-gray-200 bg-transparent text-gray-500 hover:bg-gray-50 active:scale-[0.97] transition-all"
                onClick={handleReadFull}
                disabled={readerLoading}
                aria-label={readerContent ? '关闭全文阅读' : '全文阅读'}
              >
                {readerLoading ? <span className="inline-flex items-center gap-1.5"><Spinner size={12} /> 加载中</span> : readerContent ? '📖 关闭阅读' : '📖 全文阅读'}
              </button>

              <span className="w-px h-5 bg-gray-200 mx-0.5 hidden sm:block" />

              {/* Save later */}
              <button
                className={`px-2 py-1.5 rounded text-[12px] font-medium border transition-all active:scale-[0.97] ${
                  savedLater ? 'border-indigo-200 bg-indigo-50 text-indigo-600' : 'border-gray-200 bg-transparent text-gray-500 hover:bg-gray-50'
                }`}
                onClick={handleSaveLater}
                aria-label={savedLater ? '已加入稍后读' : '稍后读'}
              >
                {savedLater ? '✓ 已稍后读' : '🔖 稍后读'}
              </button>

              {/* Share */}
              <div className="relative" ref={shareRef}>
                <button
                  className="px-2 py-1.5 rounded text-[12px] font-medium border border-gray-200 bg-transparent text-gray-500 hover:bg-gray-50 active:scale-[0.97] transition-all"
                  onClick={() => setShowShare(!showShare)}
                  aria-label="分享"
                  aria-expanded={showShare}
                >
                  ↗ 分享到
                </button>
                {showShare && (
                  <div className="absolute bottom-full left-0 mb-1 bg-white border border-gray-200 rounded-lg shadow-lg py-1 min-w-[140px] z-10" style={{ animation: 'fadeSlideIn 0.15s ease' }}>
                    <a href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(currentItem.title)}&url=${encodeURIComponent(shareUrl)}`} target="_blank" rel="noopener noreferrer" className="block px-4 py-2.5 text-[13px] text-gray-700 hover:bg-gray-50 min-h-[44px] flex items-center" onClick={() => setShowShare(false)}>𝕏 Twitter</a>
                    <a href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(currentItem.title)}`} target="_blank" rel="noopener noreferrer" className="block px-4 py-2.5 text-[13px] text-gray-700 hover:bg-gray-50 min-h-[44px] flex items-center" onClick={() => setShowShare(false)}>✈ Telegram</a>
                    <a href={`https://wa.me/?text=${encodeURIComponent(currentItem.title + ' ' + shareUrl)}`} target="_blank" rel="noopener noreferrer" className="block px-4 py-2.5 text-[13px] text-gray-700 hover:bg-gray-50 min-h-[44px] flex items-center" onClick={() => setShowShare(false)}>WhatsApp</a>
                    <button onClick={() => { copyLink(); setShowShare(false); }} className="block w-full text-left px-4 py-2.5 text-[13px] text-gray-700 hover:bg-gray-50 min-h-[44px] flex items-center">复制链接</button>
                  </div>
                )}
              </div>

              <span className="w-px h-4 bg-gray-200 mx-0.5" />

              <button
                className="px-2 py-1.5 rounded text-[12px] font-medium border border-gray-200 bg-transparent text-gray-500 hover:bg-gray-50 active:scale-[0.97] transition-all"
                onClick={onClose}
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

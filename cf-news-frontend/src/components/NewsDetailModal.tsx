import { useState, useEffect, useRef, useCallback } from 'react';
import type { CredibilityReport, NewsItem, PerspectiveReport, NewsEntity, RelatedArticle } from '../types';
import { addReadLater, getCredibility, getPerspectives, getEntities, triggerSummarizeOne, getNewsItem, triggerTake, triggerIllustration, getRelatedArticles } from '../api/client';
import Comments from './Comments';
import { stripHtml, estimateReadingTime, sanitizeHtml, formatTime, CAT_NAMES, CAT_COLORS } from '../utils/newsFormat';


/* ═══════════════════════════════════════════════════════
   Sub-Components
   ═══════════════════════════════════════════════════════ */

/* ─── SVG 图标库（与 NewsCard 一致的 stroke/fill 风格） ─── */
const iconPaths = {
  sparkle: { d: ['M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z'], fill: true },
  xlogo: { d: ['M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z'], fill: true },
  fire: { d: ['M12.963 2.286a.75.75 0 00-1.071-.136 9.742 9.742 0 00-3.539 6.176 7.547 7.547 0 01-1.705-1.715.75.75 0 00-1.152-.082A9 9 0 1015.68 4.534a7.46 7.46 0 01-2.717-2.248zM15.75 14.25a3.75 3.75 0 11-7.313-1.172c.628.465 1.35.81 2.133 1a5.99 5.99 0 011.925-3.546 3.75 3.75 0 013.255 3.718z'], fill: true },
  close: { d: ['M6 6l12 12M18 6L6 18'] },
  volume: { d: ['M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z'] },
  stop: { d: ['M5.25 7.5A2.25 2.25 0 017.5 5.25h9a2.25 2.25 0 012.25 2.25v9a2.25 2.25 0 01-2.25 2.25h-9a2.25 2.25 0 01-2.25-2.25v-9z'] },
  globe: { d: ['M12 21a9 9 0 100-18 9 9 0 000 18z', 'M3.6 9h16.8', 'M3.6 15h16.8', 'M12 3a15 15 0 010 18', 'M12 3a15 15 0 000 18'] },
  paint: { d: ['M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42'] },
  pencil: { d: ['M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L6.832 19.82a4.5 4.5 0 01-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 011.13-1.897L16.863 4.487zm0 0L19.5 7.125'] },
  bookmark: { d: ['M17.593 3.322c-1.1.128-1.907 1.077-1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z'] },
  book: { d: ['M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25'] },
  link: { d: ['M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244'] },
  external: { d: ['M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25'] },
  share: { d: ['M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z'] },
  shield: { d: ['M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z'] },
  signal: { d: ['M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.79M12 12h.008v.007H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z'] },
  tag: { d: ['M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z', 'M6 6h.008v.008H6V6z'] },
  person: { d: ['M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z'] },
  building: { d: ['M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21'] },
  pin: { d: ['M15 10.5a3 3 0 11-6 0 3 3 0 016 0z', 'M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z'] },
  hashes: { d: ['M7.5 8.25h9m-9 3H12m-9.75 3h9m-9.75 3H12m9.75-9h-1.5m-1.5 0h-1.5m-1.5 0h-1.5m3.75 3h-1.5m-1.5 0h-1.5m-1.5 0h-1.5'] },
  calendar: { d: ['M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5'] },
  paperclip: { d: ['M18.375 12.739l-7.693 7.693a4.5 4.5 0 01-6.364-6.364l10.94-10.94A3 3 0 1119.5 7.372L8.552 18.32m.009-.01l-.01.01m5.699-9.941l-7.81 7.81a1.5 1.5 0 002.112 2.13'] },
  camera: { d: ['M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z', 'M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z'] },
  sun: { d: ['M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z'] },
  moon: { d: ['M21.752 15.002A9.718 9.718 0 0118 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 003 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 009.002-5.998z'] },
  clock: { d: ['M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z'] },
  alert: { d: ['M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z'] },
  paperplane: { d: ['M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5'] },
  phone: { d: ['M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 002.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 01-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 00-1.091-.852H4.5A2.25 2.25 0 002.25 4.5v2.25z'] },
} satisfies Record<string, { d: string[]; fill?: boolean }>;

function Icon({ name, className = 'w-3.5 h-3.5', filled }: { name: keyof typeof iconPaths; className?: string; filled?: boolean }) {
  const cfg = iconPaths[name];
  const isFilled = filled ?? ('fill' in cfg ? cfg.fill : false);
  return (
    <svg
      className={`shrink-0 ${className}`}
      viewBox="0 0 24 24"
      fill={isFilled ? 'currentColor' : 'none'}
      stroke={isFilled ? 'none' : 'currentColor'}
      strokeWidth={isFilled ? undefined : 1.8}
      strokeLinecap={isFilled ? undefined : 'round'}
      strokeLinejoin={isFilled ? undefined : 'round'}
      aria-hidden="true"
    >
      {cfg.d.map((path, i) => <path key={i} d={path} />)}
    </svg>
  );
}

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
      <span className="text-red-400 shrink-0"><Icon name="alert" className="w-4 h-4" /></span>
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
      <button className="shrink-0 text-red-400 hover:text-red-600 p-1 min-w-[32px] min-h-[32px] flex items-center justify-center" onClick={onDismiss} aria-label="关闭错误提示"><Icon name="close" className="w-4 h-4" /></button>
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
              <Icon name="close" className="w-4 h-4" />
            </button>
          </div>

          {/* ─── Scrollable Content ─── */}
          <div className="overflow-y-auto flex-1 overscroll-contain">
            <div className="px-3 sm:px-5 py-2 sm:py-3">

              {/* ─── Title ─── */}
              <h2 className="text-[21px] sm:text-[22px] font-bold leading-snug tracking-tight mb-3 text-gray-900">{currentItem.title}</h2>

              {/* ─── Meta Row ─── */}
              <div className="flex gap-x-3 gap-y-1.5 text-[13px] text-gray-400 mb-2.5 items-center flex-wrap">
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
                  {ttsLoading ? <span className="inline-flex items-center gap-1"><Spinner size={12} /> 加载中</span> : playing ? <span className="inline-flex items-center gap-1"><Icon name="stop" className="w-3.5 h-3.5" /> 停止</span> : <span className="inline-flex items-center gap-1"><Icon name="volume" className="w-3.5 h-3.5" /> 播报</span>}
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
                  <div className="mb-4 rounded-xl border border-gray-100 bg-white p-3 sm:p-4 space-y-2.5">
                    <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-0.5"><span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />AI 洞察</div>

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
                        {summarizing ? <span className="inline-flex items-center gap-1.5"><Spinner size={12} /> 生成中...</span> : <span className="inline-flex items-center gap-1.5"><Icon name="sparkle" className="w-3.5 h-3.5" /> 生成 AI 摘要</span>}
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
                          {taking ? <span className="inline-flex items-center gap-1.5"><Spinner size={12} /> AI 思考中...</span> : <span className="inline-flex items-center gap-1.5"><Icon name="fire" className="w-3.5 h-3.5" /> AI 吐槽</span>}
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
                        {translating ? <span className="inline-flex items-center gap-1.5"><Spinner size={12} /> 翻译中...</span> : <span className="inline-flex items-center gap-1.5"><Icon name="globe" className="w-3.5 h-3.5" /> 翻译为中文</span>}
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
                          <span className="inline-flex items-center gap-1"><Icon name="paint" className="w-3 h-3" /> AI 生成插画</span>
                          <button
                            className="hover:text-indigo-500 transition active:scale-[0.97] min-h-[28px]"
                            onClick={() => setIllustrationUrl(null)}
                            aria-label="关闭插画"
                          >
                            <Icon name="close" className="w-3 h-3" /> 关闭
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
                        {illustrating ? <span className="inline-flex items-center gap-1.5"><Spinner size={12} /> 生成中...</span> : <span className="inline-flex items-center gap-1.5"><Icon name="paint" className="w-3.5 h-3.5" /> AI 插画</span>}
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
                      {summarizing ? <span className="inline-flex items-center gap-1.5"><Spinner size={12} /> 生成中...</span> : <span className="inline-flex items-center gap-1.5"><Icon name="sparkle" className="w-3.5 h-3.5" /> 生成 AI 摘要</span>}
                    </button>
                    <button
                      type="button"
                      className="px-3.5 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:border-purple-500 hover:text-purple-500 active:scale-[0.97] transition-all disabled:opacity-40 news-detail-btn"
                      onClick={handleIllustration}
                      disabled={illustrating}
                    >
                      {illustrating ? <span className="inline-flex items-center gap-1.5"><Spinner size={12} /> 生成中...</span> : <span className="inline-flex items-center gap-1.5"><Icon name="paint" className="w-3.5 h-3.5" /> AI 插画</span>}
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
                        <button className={`text-xs px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 min-h-[32px] transition-all active:scale-[0.97] ${readerDark ? 'bg-gray-800 text-gray-300 hover:bg-gray-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`} onClick={() => setReaderDark(!readerDark)}>
                          {readerDark ? <><Icon name="sun" className="w-3.5 h-3.5" /> 白天</> : <><Icon name="moon" className="w-3.5 h-3.5" /> 夜间</>}
                        </button>
                        <button className={`text-xs px-3 py-1.5 rounded-lg inline-flex items-center gap-1.5 min-h-[32px] transition-all active:scale-[0.97] ${readerDark ? 'bg-gray-800 text-gray-300 hover:bg-gray-700' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`} onClick={() => setReaderContent(null)} aria-label="关闭阅读">
                          <Icon name="close" className="w-3.5 h-3.5" /> 关闭
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
                    <div className="flex border-b border-gray-100 bg-gray-50/60">
                      {([
                        { key: 'credibility' as const, label: '可信度', icon: 'shield' as const, active: 'text-emerald-700 bg-white border-b-2 border-emerald-500' },
                        { key: 'perspectives' as const, label: '观点光谱', icon: 'signal' as const, active: 'text-indigo-700 bg-white border-b-2 border-indigo-500' },
                        { key: 'entities' as const, label: '关键实体', icon: 'tag' as const, active: 'text-cyan-700 bg-white border-b-2 border-cyan-500' },
                      ]).map(tab => (
                        <button
                          key={tab.key}
                          className={`flex-1 px-3 py-2.5 text-[12px] font-medium transition-all active:scale-[0.97] inline-flex items-center justify-center gap-1.5 ${
                            analysisTab === tab.key
                              ? tab.active
                              : 'text-gray-500 hover:text-gray-700 hover:bg-white/60'
                          }`}
                          onClick={() => {
                            setAnalysisTab(tab.key);
                            if (tab.key === 'credibility' && !credibility && !credLoading) handleCredibility();
                            if (tab.key === 'perspectives' && !perspectives && !perspectiveLoading) handlePerspectives();
                            if (tab.key === 'entities' && !entities && !entityLoading) handleEntities();
                          }}
                        >
                          <Icon name={tab.icon} className="w-3.5 h-3.5" />
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
                                  const labels: Record<string, string> = { person: '人物', organization: '组织', location: '地点', number: '数字', event: '事件' };
                                  const icons: Record<string, keyof typeof iconPaths> = { person: 'person', organization: 'building', location: 'pin', number: 'hashes', event: 'calendar' };
                                  const colors: Record<string, string> = { person: 'bg-blue-100 text-blue-700', organization: 'bg-purple-100 text-purple-700', location: 'bg-green-100 text-green-700', number: 'bg-amber-100 text-amber-700', event: 'bg-red-100 text-red-700' };
                                  return (
                                    <div key={type}>
                                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-cyan-600 mb-1"><Icon name={icons[type]} className="w-3 h-3" />{labels[type]}</div>
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
                          {screenshotLoading ? <span className="inline-flex items-center gap-1"><Spinner size={10} /> 截图中</span> : <span className="inline-flex items-center gap-1"><Icon name="camera" className="w-3.5 h-3.5" /> 截图</span>}
                        </button>
                        <button
                          className="text-xs px-2.5 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-600 hover:bg-gray-100 active:scale-[0.97] transition-all min-h-[32px]"
                          onClick={() => onOpenUrl(currentItem.url)}
                        >
                          <span className="inline-flex items-center gap-1"><Icon name="external" className="w-3.5 h-3.5" /> 新标签</span>
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
                          <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-gray-500"><Icon name="paperclip" className="w-3.5 h-3.5" /> 相关推荐</span>
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
                className="inline-flex items-center justify-center gap-1 h-8 px-3.5 rounded-lg bg-indigo-500 text-white text-[12px] font-medium hover:bg-indigo-600 active:scale-[0.97] transition-all shadow-sm"
                onClick={() => { setSourceView(sourceView ? null : 'iframe'); setReaderContent(null); }}
                aria-label={sourceView ? '关闭原站' : '浏览原站'}
              >
                {sourceView ? '关闭原站' : <span className="inline-flex items-center gap-1"><Icon name="link" className="w-3.5 h-3.5" /> 原站浏览</span>}
              </button>
              <button
                className="inline-flex items-center justify-center gap-1 h-8 px-3 rounded-lg text-[12px] font-medium border border-gray-200 bg-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700 hover:border-gray-300 active:scale-[0.97] transition-all"
                onClick={handleReadFull}
                disabled={readerLoading}
                aria-label={readerContent ? '关闭全文阅读' : '全文阅读'}
              >
                {readerLoading ? <span className="inline-flex items-center gap-1.5"><Spinner size={12} /> 加载中</span> : readerContent ? <span className="inline-flex items-center gap-1"><Icon name="book" className="w-3.5 h-3.5" /> 关闭阅读</span> : <span className="inline-flex items-center gap-1"><Icon name="book" className="w-3.5 h-3.5" /> 全文阅读</span>}
              </button>

              <span className="w-px h-5 bg-gray-200 mx-0.5 hidden sm:block" />

              {/* Save later */}
              <button
                className={`inline-flex items-center justify-center gap-1 h-8 px-3 rounded-lg text-[12px] font-medium border transition-all active:scale-[0.97] ${
                  savedLater ? 'border-indigo-200 bg-indigo-50 text-indigo-600' : 'border-gray-200 bg-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700 hover:border-gray-300'
                }`}
                onClick={handleSaveLater}
                aria-label={savedLater ? '已加入稍后读' : '稍后读'}
              >
                {savedLater ? <span className="inline-flex items-center gap-1"><Icon name="bookmark" className="w-3.5 h-3.5" filled /> 已稍后读</span> : <span className="inline-flex items-center gap-1"><Icon name="bookmark" className="w-3.5 h-3.5" /> 稍后读</span>}
              </button>

              {/* Share */}
              <div className="relative" ref={shareRef}>
                <button
                  className="inline-flex items-center justify-center gap-1 h-8 px-3 rounded-lg text-[12px] font-medium border border-gray-200 bg-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700 hover:border-gray-300 active:scale-[0.97] transition-all"
                  onClick={() => setShowShare(!showShare)}
                  aria-label="分享"
                  aria-expanded={showShare}
                >
                  <span className="inline-flex items-center gap-1"><Icon name="share" className="w-3.5 h-3.5" /> 分享到</span>
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
                className="inline-flex items-center justify-center gap-1 h-8 px-3 rounded-lg text-[12px] font-medium border border-gray-200 bg-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-700 hover:border-gray-300 active:scale-[0.97] transition-all"
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

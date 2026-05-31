import { useEffect, useState, useCallback, useRef } from 'react';
import type { NewsItem, NewsSource, User, Pagination } from '../types';
import { getNews, getSources, triggerFetch, getMe, triggerSummarizeOne, getNewsItem } from '../api/client';
import Header from '../components/Header';
import CategoryNav from '../components/CategoryNav';
import NewsCard from '../components/NewsCard';
import AuthModal from '../components/AuthModal';
import NewsDetailModal from '../components/NewsDetailModal';
import SourceManager from '../components/SourceManager';
import ClipboardShare from '../components/ClipboardShare';
import DailyDigest from '../components/DailyDigest';
import NewsQA from '../components/NewsQA';
import Footer from '../components/Footer';
import { useClipboardWS } from '../hooks/useClipboardWS';
import { getDailyDigest, getDigestDates } from '../api/client';

const CATEGORIES = [
  { key: 'all', label: '全部', emoji: '✦' },
  { key: 'ai', label: 'AI 动态', emoji: '⟡' },
  { key: 'tech', label: '科技', emoji: '⚙' },
  { key: 'news', label: '新闻', emoji: '◇' },
  { key: 'finance', label: '财经', emoji: '₿' },
  { key: 'entertainment', label: '娱乐', emoji: '✦' },
];

export default function Home() {
  const [news, setNews] = useState<NewsItem[]>([]);
  const [sources, setSources] = useState<NewsSource[]>([]);
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [category, setCategory] = useState('all');
  const [sourceId, setSourceId] = useState<number | null>(null);
  const [lang, setLang] = useState<string>('');
  const [filterSummary, setFilterSummary] = useState<string | undefined>(undefined);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<{ msg: string; type: string } | null>(null);
  const [selectedNews, setSelectedNews] = useState<NewsItem | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [hasNewNews, setHasNewNews] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [summarizing, setSummarizing] = useState(false);
  const [showManager, setShowManager] = useState(false);
  const [showClipboard, setShowClipboard] = useState(() => { try { return localStorage.getItem('cb_panel_open') === '1'; } catch { return false; } });
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [digestData, setDigestData] = useState<import('../types').DailyDigest | null>(null);
  const [digestLoading, setDigestLoading] = useState(true);
  const [digestCollapsed, setDigestCollapsed] = useState(true);
  const [digestRegenerating, setDigestRegenerating] = useState(false);
  const [digestDates, setDigestDates] = useState<string[]>([]);
  const [showQA, setShowQA] = useState(false);
  const [loginToast, setLoginToast] = useState<string | null>(null);
  const latestIdRef = useRef(0);
  const cooldownTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clipboard = useClipboardWS(token || '', showClipboard);

  useEffect(() => {
    if (clipboard.hasNewData) {
      setShowClipboard(true);
    }
  }, [clipboard.hasNewData]);

  const showToast = (msg: string, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  useEffect(() => { try { localStorage.setItem('cb_panel_open', showClipboard ? '1' : '0'); } catch {} }, [showClipboard]);

  // Load daily digest
  useEffect(() => {
    getDailyDigest().then(data => {
      setDigestData(data.digest || null);
      setDigestLoading(false);
    }).catch(() => {
      setDigestLoading(false);
    });
    getDigestDates().then(setDigestDates).catch(() => {});
  }, []);

  async function handleDigestDateChange(date: string) {
    setDigestLoading(true);
    try {
      const data = await getDailyDigest(date);
      setDigestData(data.digest || null);
      setDigestCollapsed(false);
    } catch {}
    setDigestLoading(false);
  }

  async function handleRegenerateDigest() {
    setDigestRegenerating(true);
    try {
      const res = await fetch('/api/ai/digest/generate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (data.digest) {
        setDigestData(data.digest);
        setDigestCollapsed(false);
      }
    } catch {}
    setDigestRegenerating(false);
  }

  useEffect(() => { if (token) { getMe().then(setUser).catch(() => { localStorage.removeItem('token'); setToken(null); }); } }, [token]);
  useEffect(() => { getSources().then(setSources).catch(() => {}); }, []);

  // On mount, check URL for shared news ID
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('id') || window.location.pathname.match(/^\/share\/(\d+)/)?.[1];
    if (id) {
      getNewsItem(parseInt(id)).then(item => {
        if (item) {
          setSelectedNews(item);
          document.title = `${item.title} - News`;
        }
      }).catch(() => {});
    }
  }, []);

  // Load news when filters change
  useEffect(() => { (async () => {
    const items = await loadNews();
    if (items.length > 0 && page === 1) latestIdRef.current = Math.max(...items.map(n => n.id));
  })(); }, [category, sourceId, search, filterSummary, page, lang]);

  function selectNews(item: NewsItem) {
    setSelectedNews(item);
    document.title = `${item.title} - News`;
    getNewsItem(item.id).then(full => setSelectedNews(full)).catch(() => {});
    window.history.replaceState({}, '', `/share/${item.id}`);
  }
  function closeNews() {
    setSelectedNews(null);
    document.title = 'News - 每日新闻聚合';
    window.history.replaceState({}, '', '/');
  }

  const loadNews = useCallback(async (pg?: number): Promise<NewsItem[]> => {
    setLoading(true);
    try {
      const data = await getNews({ category: category === 'all' ? undefined : category, source_id: sourceId ?? undefined, search: search || undefined, lang, has_summary: filterSummary, page: pg || page, limit: 20 });
      setNews(data.news); setPagination(data.pagination); return data.news;
    } catch { showToast('加载新闻失败', 'error'); return []; } finally { setLoading(false); }
  }, [category, sourceId, search, filterSummary, page, lang]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const data = await getNews({ category: category === 'all' ? undefined : category, lang, limit: 1 });
        if (data.news.length > 0 && data.news[0].id > latestIdRef.current && latestIdRef.current > 0) {
          setHasNewNews(true);
          if (page === 1) {
            const full = await getNews({ category: category === 'all' ? undefined : category, lang, limit: 20, page: 1 });
            if (full.news.length > 0) {
              setNews(full.news); setPagination(full.pagination);
              latestIdRef.current = Math.max(...full.news.map(n => n.id));
              setHasNewNews(false);
            }
          }
        }
      } catch {}
    }, 60000);
    return () => clearInterval(interval);
  }, [category, lang, page]);

  function goPage(p: number) { setPage(p); window.scrollTo(0, 0); }

  async function handleRefresh() {
    if (refreshing || cooldown > 0) return;
    setRefreshing(true);
    try {
      await triggerFetch(); showToast('✅ 新闻抓取完成，5 分钟后再试', 'success');
      const items = await loadNews(); if (items.length > 0) latestIdRef.current = Math.max(...items.map(n => n.id));
      setHasNewNews(false); setCooldown(300);
      if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current);
      cooldownTimerRef.current = setInterval(() => { setCooldown(c => { if (c <= 1) { if (cooldownTimerRef.current) clearInterval(cooldownTimerRef.current); return 0; } return c - 1; }); }, 1000);
    } catch { showToast('抓取失败', 'error'); } finally { setRefreshing(false); }
  }

  async function handleSummarize() {
    if (summarizing) return;
    const ids = news.filter(n => !n.ai_summary).map(n => n.id);
    if (ids.length === 0) { showToast('没有需要摘要的新闻', 'error'); return; }
    setSummarizing(true);
    let done = 0;
    for (const id of ids) {
      try {
        const result = await triggerSummarizeOne(id);
        if (result.generated > 0) {
          done++;
          const updated = await getNewsItem(id);
          if (updated) setNews(prev => prev.map(n => n.id === id ? { ...n, ai_summary: updated.ai_summary } : n));
        }
      } catch {}
    }
    if (done > 0) showToast(`✅ 共生成 ${done}/${ids.length} 条摘要`, 'success');
    else showToast('摘要生成失败', 'error');
    setSummarizing(false);
  }

  function handleLoginSuccess(t: string) { setToken(t); setShowAuth(false); }
  function handleLogout() { localStorage.removeItem('token'); setToken(null); setUser(null); }

  useEffect(() => {
    if (!token) return;
    fetch('/api/user/digest', { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json()).then(d => setDigestEnabled(!!d.receive_digest)).catch(() => {});
  }, [token]);

  async function handleToggleDigest() {
    if (!token) return;
    try {
      const res = await fetch('/api/user/digest', { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      setDigestEnabled(!!data.receive_digest);
      showToast(data.receive_digest ? '✅ 已订阅每日摘要' : '已取消订阅');
    } catch { showToast('操作失败', 'error'); }
  }

  async function handleExport() {
    if (!token) return;
    try {
      const res = await fetch('/api/user/export', { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: '导出失败' }));
        showToast(err.error || '导出失败', 'error');
        return;
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `favorites-${new Date().toISOString().split('T')[0]}.md`;
      a.click(); URL.revokeObjectURL(url);
      showToast('✅ 导出成功');
    } catch { showToast('导出失败', 'error'); }
  }

  async function handleRecommendations() {
    if (!token) { showToast('请先登录', 'error'); return; }
    try {
      const res = await fetch('/api/user/recommendations?limit=20', { headers: { Authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (data.recommendations?.length > 0) {
        setNews(data.recommendations);
        showToast(`✅ 为你推荐 ${data.recommendations.length} 条`);
      } else { showToast('暂无推荐'); }
    } catch { showToast('获取推荐失败', 'error'); }
  }

  return (
    <div className="max-w-[1280px] mx-auto p-6">
      <Header
        user={user} refreshing={refreshing} cooldown={cooldown}
        search={search} lang={lang}
        sourceCount={sources.length}
        totalNews={pagination?.total ?? 0}
        lastFetchedAt={sources.reduce((latest, s) => s.last_fetched_at && s.last_fetched_at > latest ? s.last_fetched_at : latest, '')}
        sources={sources} sourceId={sourceId}
        digestEnabled={digestEnabled}
        onToggleDigest={handleToggleDigest}
        onExport={handleExport} onRecommendations={handleRecommendations}
        onQA={() => setShowQA(true)}
        onLogin={() => setShowAuth(true)} onRegister={() => setShowAuth(true)}
        onRefresh={handleRefresh} onLogout={handleLogout}
        onSearchChange={setSearch} onSearch={() => { setPage(1); loadNews(); }}
        onLangChange={v => { setLang(v); setPage(1); }}
        onSourceChange={id => { setSourceId(id); setPage(1); }}
        showManager={showManager} onManageSources={() => setShowManager(!showManager)}
        showClipboard={showClipboard} onToggleClipboard={() => {
          if (!token) {
            setLoginToast('请先登录以使用共享粘贴板');
            setTimeout(() => setLoginToast(null), 2500);
            return;
          }
          setShowClipboard(!showClipboard);
        }}
        clipboardHasNew={clipboard.hasNewData}
        onClearClipboardFlag={clipboard.clearNewDataFlag}
      />
      {hasNewNews && <div className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white px-5 py-3 rounded-lg mb-4 cursor-pointer font-medium text-sm text-center shadow animate-pulse hover:opacity-95" onClick={() => { setHasNewNews(false); setPage(1); loadNews(1); }}>⟡ 有新新闻，点击刷新</div>}
      <DailyDigest digest={digestData} loading={digestLoading} collapsed={digestCollapsed} regenerating={digestRegenerating} dates={digestDates} onToggle={() => setDigestCollapsed(!digestCollapsed)} onRegenerate={handleRegenerateDigest} onDateChange={handleDigestDateChange} />
      <CategoryNav categories={CATEGORIES} active={category} onSelect={k => { setCategory(k); setSourceId(null); setPage(1); }} />
      <div className="flex gap-2.5 mb-5 items-center flex-wrap">
        <button className="px-4 py-2.5 rounded-lg text-[13px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 hover:border-indigo-500 hover:text-indigo-500 transition disabled:opacity-40 disabled:cursor-not-allowed" onClick={handleSummarize} disabled={summarizing}>{summarizing ? '⟡ 生成中...' : '⟡ AI 摘要'}</button>
        <button className={`px-4 py-2.5 rounded-lg text-[13px] font-medium border transition ${filterSummary ? 'bg-indigo-500 text-white border-transparent' : 'bg-transparent text-gray-600 border-gray-200 hover:bg-gray-50'}`} onClick={() => { setFilterSummary(filterSummary ? undefined : '1'); setPage(1); }}>⟡ 有摘要</button>
      </div>
      {showManager && token && <SourceManager token={token} onClose={() => setShowManager(false)} />}
      {showClipboard && token && <ClipboardShare
        visible={showClipboard}
        onClose={() => setShowClipboard(false)}
        text={clipboard.text}
        images={clipboard.images}
        connected={clipboard.connected}
        connecting={clipboard.connecting}
        pendingCount={clipboard.pendingCount}
        deviceName={clipboard.deviceName}
        onSendText={clipboard.sendText}
        onSendImage={clipboard.sendImage}
        onSyncClipboard={clipboard.syncClipboard}
        onClearImages={clipboard.clearImages}
        incomingOffers={clipboard.incomingOffers}
        fileTransfers={clipboard.fileTransfers}
        onSendFile={clipboard.sendFile}
        onAcceptFile={clipboard.acceptFileOffer}
        onRejectFile={clipboard.rejectFileOffer}
        onCancelFile={clipboard.cancelFileTransfer}
      />}
      {loading ? (
        <div className="text-center py-20 text-gray-400 flex flex-col items-center gap-4"><div className="w-8 h-8 border-2 border-gray-200 border-t-indigo-500 rounded-full animate-spin"></div><p>加载中...</p></div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {news.length === 0 && <p className="text-gray-400 text-center py-20 col-span-full text-sm">暂无新闻</p>}
            {news.map(item => <NewsCard key={item.id} item={item} token={token} onAuthRequired={() => setShowAuth(true)} onSelect={selectNews} />)}
          </div>
          {pagination && pagination.totalPages > 1 && (
            <div className="flex justify-center items-center gap-4 mt-8 py-5">
              <button className="px-4 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 transition disabled:opacity-30 disabled:cursor-not-allowed" disabled={page <= 1} onClick={() => goPage(page - 1)}>◀ 上一页</button>
              <span className="text-gray-400 text-sm">{page} / {pagination.totalPages}</span>
              <button className="px-4 py-2 rounded-lg text-[13px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 transition disabled:opacity-30 disabled:cursor-not-allowed" disabled={page >= pagination.totalPages} onClick={() => goPage(page + 1)}>下一页 ▶</button>
            </div>
          )}
        </>
      )}
      <AuthModal visible={showAuth} onClose={() => setShowAuth(false)} onLoginSuccess={handleLoginSuccess} />
      <NewsQA visible={showQA} onClose={() => setShowQA(false)} token={token} />
      <NewsDetailModal item={selectedNews} token={token} onClose={closeNews} onOpenUrl={url => window.open(url, '_blank')} onSummaryGenerated={() => { loadNews(); }} />
      <Footer />
      {toast && <div className={`fixed bottom-5 right-5 px-5 py-3 rounded-lg text-[13px] shadow-lg z-50 animate-[slideIn_0.2s_ease] ${toast.type === 'success' ? 'bg-white border border-emerald-500 text-gray-900' : 'bg-white border border-red-500 text-gray-900'}`}>{toast.msg}</div>}
      {loginToast && <div className="fixed top-4 right-4 px-4 py-2.5 rounded-lg text-[13px] shadow-lg z-50 animate-[slideIn_0.2s_ease] bg-white border border-amber-400 text-amber-700 flex items-center gap-2">
        <span>📋</span> {loginToast}
      </div>}
    </div>
  );
}

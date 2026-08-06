import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { NewsItem, NewsRegion, RadarAlert, TimelineEvent } from '../types';
import {
  addRadarKeyword,
  getFreshView,
  getNewsMap,
  getRadar,
  getReadLater,
  getTimeline,
  removeRadarKeyword,
  removeReadLater,
} from '../api/client';
import { formatTime } from '../utils/newsFormat';

type Tab = 'timeline' | 'map' | 'radar' | 'later' | 'fresh';

interface Props {
  visible: boolean;
  token: string | null;
  search: string;
  activeCategory: string;
  onClose: () => void;
  onSelectArticle: (item: NewsItem) => void;
  onSearch: (keyword: string) => void;
  onAuthRequired: () => void;
}


/* ═══════════════════════════════════════════════════════
   SVG 图标库（与 NewsDetailModal 一致的 stroke/fill 风格）
   ═══════════════════════════════════════════════════════ */

const iconPaths = {
  clock: { d: ['M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z'] },
  pin: { d: ['M15 10.5a3 3 0 11-6 0 3 3 0 016 0z', 'M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z'] },
  signal: { d: ['M9.348 14.651a3.75 3.75 0 010-5.303m5.304 0a3.75 3.75 0 010 5.303m-7.425 2.122a6.75 6.75 0 010-9.546m9.546 0a6.75 6.75 0 010 9.546M5.106 18.894c-3.808-3.808-3.808-9.98 0-13.789m13.788 0c3.808 3.808 3.808 9.981 0 13.79M12 12h.008v.007H12V12zm.375 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z'] },
  bookmark: { d: ['M17.593 3.322c-1.1.128-1.907 1.077-1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z'] },
  sparkle: { d: ['M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8L12 2z'], fill: true },
  close: { d: ['M6 6l12 12M18 6L6 18'] },
  search: { d: ['M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z'] },
  folder: { d: ['M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z'] },
  bell: { d: ['M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0'] },
} satisfies Record<string, { d: string[]; fill?: boolean }>;

function Icon({ name, className = 'h-3.5 w-3.5', filled }: { name: keyof typeof iconPaths; className?: string; filled?: boolean }) {
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


/* ═══════════════════════════════════════════════════════
   Skeleton / EmptyState / ArticleRow
   ═══════════════════════════════════════════════════════ */

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse bg-gray-200 ${className}`} aria-hidden="true" />;
}

function TimelineSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-gray-100 bg-white p-3">
          <Skeleton className="h-3 w-1/4 rounded-full" />
          <Skeleton className="mt-2 h-4 w-full rounded-md" />
          <Skeleton className="mt-2 h-4 w-5/6 rounded-md" />
          <Skeleton className="mt-2 h-3 w-1/3 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function MapSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="rounded-lg border border-gray-100 bg-white p-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-20 rounded-md" />
            <Skeleton className="h-3 w-10 rounded-full" />
          </div>
          <Skeleton className="mt-2 h-1.5 w-full rounded-full" />
          <Skeleton className="mt-2 h-3 w-full rounded-md" />
          <Skeleton className="mt-1.5 h-3 w-3/4 rounded-md" />
        </div>
      ))}
    </div>
  );
}

function ListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border border-gray-100 bg-white p-3">
          <Skeleton className="h-4 w-full rounded-md" />
          <Skeleton className="mt-2 h-3 w-1/3 rounded-full" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ icon, title, hint }: { icon: keyof typeof iconPaths; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-indigo-50 text-indigo-400">
        <Icon name={icon} className="h-6 w-6" />
      </div>
      <div className="mt-3 text-sm font-medium text-gray-700">{title}</div>
      {hint && <div className="mt-1 max-w-xs text-[12px] leading-relaxed text-gray-400">{hint}</div>}
    </div>
  );
}

function ArticleRow({ item, onSelect, action }: { item: NewsItem; onSelect: (item: NewsItem) => void; action?: ReactNode }) {
  const displayTime = formatTime(item.published_at || item.created_at || '');
  return (
    <div className="flex items-start gap-2 rounded-lg border border-gray-100 bg-white px-3 py-2 hover:border-indigo-200">
      <button className="min-w-0 flex-1 text-left" onClick={() => onSelect(item)}>
        <div className="line-clamp-2 text-[13px] font-medium leading-snug text-gray-900">{item.title}</div>
        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-gray-400">
          <span>{item.source_name || '未知来源'}</span>
          {item.category && <span>{item.category}</span>}
          {displayTime && <span>{displayTime}</span>}
        </div>
      </button>
      {action}
    </div>
  );
}


/* ═══════════════════════════════════════════════════════
   Tab 配置 / 阶段辅助函数
   ═══════════════════════════════════════════════════════ */

const TABS = [
  { key: 'timeline', label: '时间线', icon: 'clock' },
  { key: 'map', label: '地图', icon: 'pin' },
  { key: 'radar', label: '雷达', icon: 'signal' },
  { key: 'later', label: '稍后读', icon: 'bookmark' },
  { key: 'fresh', label: '跳出舒适区', icon: 'sparkle' },
] as const;

function stageColor(stage: string) {
  if (stage === 'first') return 'bg-emerald-500';
  if (stage === 'latest') return 'bg-indigo-500';
  return 'bg-gray-300';
}

function stageLabel(stage: string) {
  if (stage === 'first') return '最早';
  if (stage === 'latest') return '最新';
  return '进展';
}


/* ═══════════════════════════════════════════════════════
   主组件
   ═══════════════════════════════════════════════════════ */

export default function ExplorePanel({ visible, token, search, activeCategory, onClose, onSelectArticle, onSearch, onAuthRequired }: Props) {
  const [tab, setTab] = useState<Tab>('timeline');
  const [keyword, setKeyword] = useState(search);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [regions, setRegions] = useState<NewsRegion[]>([]);
  const [radarInput, setRadarInput] = useState('');
  const [radarAlerts, setRadarAlerts] = useState<RadarAlert[]>([]);
  const [radarKeywords, setRadarKeywords] = useState<{ id: number; keyword: string; created_at: string }[]>([]);
  const [laterItems, setLaterItems] = useState<NewsItem[]>([]);
  const [freshItems, setFreshItems] = useState<NewsItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState('');

  const excludedCategories = useMemo(() => activeCategory && activeCategory !== 'all' ? [activeCategory] : ['tech', 'ai'], [activeCategory]);

  /* 打开面板 / 切换 Tab / 搜索词变化时自动加载；
     搜索非空时同步关键词，时间线按 search || keyword 生成 */
  useEffect(() => {
    if (!visible) return;
    setMessage('');
    if (search) setKeyword(search);
    if (tab === 'timeline') loadTimeline(search || keyword);
    if (tab === 'map') loadMap();
    if (tab === 'fresh') loadFresh();
    if (tab === 'radar') loadRadar();
    if (tab === 'later') loadLater();
  }, [visible, tab, search]);

  async function loadTimeline(nextKeyword = keyword) {
    setLoading(true);
    try {
      const data = await getTimeline(nextKeyword || undefined, nextKeyword ? 168 : 48);
      setTimeline(data.events || []);
    } catch {
      setMessage('时间线加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadMap() {
    setLoading(true);
    try {
      const data = await getNewsMap(48);
      setRegions(data.regions || []);
    } catch {
      setMessage('新闻地图加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadFresh() {
    setLoading(true);
    try {
      const data = await getFreshView(excludedCategories, 8);
      setFreshItems(data.recommendations || []);
    } catch {
      setMessage('推荐加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadRadar() {
    if (!token) { setMessage('登录后可使用新闻雷达'); return; }
    setLoading(true);
    try {
      const data = await getRadar(48);
      setRadarKeywords(data.keywords || []);
      setRadarAlerts(data.alerts || []);
    } catch {
      setMessage('新闻雷达加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function loadLater() {
    if (!token) { setMessage('登录后可使用稍后读'); return; }
    setLoading(true);
    try {
      setLaterItems(await getReadLater());
    } catch {
      setMessage('稍后读加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleAddRadar() {
    const value = radarInput.trim();
    if (!value) return;
    if (!token) { onAuthRequired(); return; }
    try {
      await addRadarKeyword(value);
      setRadarInput('');
      await loadRadar();
    } catch {
      setMessage('添加关键词失败');
    }
  }

  async function handleRemoveRadar(value: string) {
    try {
      await removeRadarKeyword(value);
      await loadRadar();
    } catch {
      setMessage('删除关键词失败');
    }
  }

  async function handleRemoveLater(id: number) {
    try {
      await removeReadLater(id);
      setLaterItems(items => items.filter(item => item.id !== id));
    } catch {
      setMessage('移出稍后读失败');
    }
  }

  function handleArticleSelect(item: NewsItem) {
    onSelectArticle(item);
  }

  /* ─── 计算：时间线热力条（按时间升序） / 地图热力条（按数量降序） ─── */
  const heatEvents = useMemo(() => {
    return [...timeline].sort((a, b) => {
      const ta = new Date(a.time || a.published_at || a.created_at || '').getTime();
      const tb = new Date(b.time || b.published_at || b.created_at || '').getTime();
      return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb);
    });
  }, [timeline]);

  const sortedRegions = useMemo(() => [...regions].sort((a, b) => b.count - a.count), [regions]);
  const maxCount = sortedRegions.length > 0 ? sortedRegions[0].count : 0;

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative h-full w-full max-w-xl overflow-y-auto bg-gray-50 shadow-2xl">
        {/* ─── Sticky Header ─── */}
        <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-4 pb-3 pt-4 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-900">新闻探索</div>
              <div className="text-[11px] text-gray-400">时间线、地图、雷达和稍后读</div>
            </div>
            <button className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700" onClick={onClose} aria-label="关闭">
              <Icon name="close" className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-3 flex gap-1 overflow-x-auto">
            {TABS.map(t => (
              <button
                key={t.key}
                className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors ${tab === t.key ? 'bg-indigo-500 text-white shadow-sm' : 'text-gray-500 hover:bg-gray-100'}`}
                onClick={() => setTab(t.key)}
              >
                <Icon name={t.icon} className="h-3.5 w-3.5" />
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* ─── Content（key=tab 触发切换动画） ─── */}
        <div className="p-4">
          <div key={tab} className="space-y-3 animate-slideUp">
            {message && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">{message}</div>
            )}

            {/* ─── 时间线 ─── */}
            {tab === 'timeline' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <div className="relative min-w-0 flex-1">
                    <Icon name="search" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" />
                    <input
                      className="w-full rounded-lg border border-gray-200 bg-white py-2 pl-9 pr-3 text-sm outline-none focus:border-indigo-500"
                      value={keyword}
                      onChange={e => setKeyword(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') loadTimeline(keyword); }}
                      placeholder="输入事件关键词"
                    />
                  </div>
                  <button className="rounded-lg bg-indigo-500 px-4 py-2 text-[13px] font-medium text-white hover:bg-indigo-600 active:scale-[0.97] transition-all" onClick={() => loadTimeline(keyword)}>生成</button>
                </div>

                {/* 热力条：事件按时间升序排列，颜色表示阶段 */}
                {timeline.length > 0 && (
                  <div className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="flex items-end gap-0.5">
                      {heatEvents.map((event, i) => (
                        <div
                          key={i}
                          title={`${formatTime(event.time || event.published_at || event.created_at || '')} · ${stageLabel(event.stage)}`}
                          className={`h-6 flex-1 rounded-sm ${stageColor(event.stage)}`}
                        />
                      ))}
                    </div>
                    <div className="mt-2 flex items-center gap-4 text-[11px] text-gray-400">
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500" />最早</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-indigo-500" />最新</span>
                      <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-gray-300" />进展</span>
                    </div>
                  </div>
                )}

                <div className="text-[11px] text-gray-400">按发布时间倒序排列；没有发布时间时使用抓取时间。</div>

                {loading ? (
                  <TimelineSkeleton />
                ) : timeline.length === 0 ? (
                  <EmptyState icon="search" title="暂无时间线" hint="输入关键词并点击生成，或在页面搜索后打开本面板自动生成" />
                ) : (
                  <div className="space-y-2">
                    {timeline.map((event, index) => (
                      <div key={event.id} className="flex gap-3">
                        <div className="flex w-14 shrink-0 flex-col items-center">
                          <div className={`h-2.5 w-2.5 rounded-full ${stageColor(event.stage)}`} />
                          {index < timeline.length - 1 && <div className="mt-1 h-full min-h-10 w-px bg-gray-200" />}
                        </div>
                        <button className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white p-3 text-left hover:border-indigo-200" onClick={() => handleArticleSelect(event)}>
                          <div className="text-[11px] text-gray-400">{formatTime(event.time || event.published_at || event.created_at || '')} · 北京时间 · {stageLabel(event.stage)}</div>
                          <div className="mt-1 line-clamp-2 text-sm font-medium text-gray-900">{event.title}</div>
                          <div className="mt-1 text-[11px] text-gray-400">{event.source_name || '未知来源'}</div>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ─── 地图 ─── */}
            {tab === 'map' && (
              loading ? <MapSkeleton /> : regions.length === 0 ? (
                <EmptyState icon="pin" title="暂无地图数据" hint="最近 48 小时没有识别到地区分布，稍后再来看看" />
              ) : (
                <div className="space-y-3">
                  {sortedRegions.map(region => (
                    <div key={region.code} className="rounded-lg border border-gray-200 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <div className="text-sm font-semibold text-gray-900">{region.name}</div>
                        <button className="text-[12px] text-indigo-500 hover:text-indigo-700" onClick={() => { onSearch(region.name); onClose(); }}>{region.count} 条</button>
                      </div>
                      {/* 热力条：数量相对最大值 */}
                      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-indigo-100 to-indigo-500"
                          style={{ width: maxCount > 0 ? `${(region.count / maxCount) * 100}%` : '0%' }}
                        />
                      </div>
                      <div className="mt-2 space-y-1.5">
                        {region.articles.slice(0, 3).map(article => <ArticleRow key={article.id} item={article} onSelect={handleArticleSelect} />)}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {/* ─── 雷达 ─── */}
            {tab === 'radar' && (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500"
                    value={radarInput}
                    onChange={e => setRadarInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddRadar(); }}
                    placeholder="关注关键词，如 Cloudflare"
                  />
                  <button className="rounded-lg bg-indigo-500 px-4 py-2 text-[13px] font-medium text-white hover:bg-indigo-600 active:scale-[0.97] transition-all" onClick={handleAddRadar}>添加</button>
                </div>

                {token ? (
                  <div className="flex items-center gap-1.5 rounded-lg bg-indigo-50 px-3 py-2 text-[12px] text-indigo-600">
                    <Icon name="bell" className="h-3.5 w-3.5" />
                    命中会推送浏览器通知
                  </div>
                ) : (
                  <button className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-600 hover:border-indigo-200 hover:text-indigo-500" onClick={onAuthRequired}>登录后使用雷达</button>
                )}

                {radarKeywords.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {radarKeywords.map(kw => (
                      <button
                        key={kw.id}
                        className="flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-[12px] text-gray-600 ring-1 ring-gray-200 hover:text-red-500"
                        onClick={() => handleRemoveRadar(kw.keyword)}
                        title="点击删除"
                      >
                        {kw.keyword}
                        <Icon name="close" className="h-3 w-3" />
                      </button>
                    ))}
                  </div>
                )}

                {loading ? (
                  <ListSkeleton count={3} />
                ) : radarAlerts.length === 0 ? (
                  <EmptyState icon="signal" title="暂无命中" hint="添加关注关键词后，这里会显示匹配的最新新闻" />
                ) : radarAlerts.map(alert => (
                  <div key={alert.keyword} className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-900">{alert.keyword}</div>
                      <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600 ring-1 ring-indigo-100">{alert.count} 条</span>
                    </div>
                    <div className="space-y-1.5">{alert.articles.map(article => <ArticleRow key={article.id} item={article} onSelect={handleArticleSelect} />)}</div>
                  </div>
                ))}
              </div>
            )}

            {/* ─── 稍后读 ─── */}
            {tab === 'later' && (
              !token ? (
                <button className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-600 hover:border-indigo-200 hover:text-indigo-500" onClick={onAuthRequired}>登录后查看稍后读</button>
              ) : loading ? (
                <ListSkeleton count={3} />
              ) : laterItems.length === 0 ? (
                <EmptyState icon="folder" title="暂无稍后读" hint="在文章详情页点击收藏，稍后读文章会出现在这里" />
              ) : (
                <div className="space-y-2">
                  {laterItems.map(item => (
                    <ArticleRow
                      key={item.id}
                      item={item}
                      onSelect={handleArticleSelect}
                      action={<button className="shrink-0 rounded-md px-2 py-1 text-[11px] text-gray-400 hover:bg-gray-100 hover:text-red-500" onClick={() => handleRemoveLater(item.id)}>移出</button>}
                    />
                  ))}
                </div>
              )
            )}

            {/* ─── 跳出舒适区 ─── */}
            {tab === 'fresh' && (
              loading ? (
                <ListSkeleton count={3} />
              ) : freshItems.length === 0 ? (
                <EmptyState icon="sparkle" title="暂无推荐" hint="尝试切换分类后重新打开，或稍后再来看看" />
              ) : (
                <div className="space-y-2">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">
                    <div className="flex items-center gap-1.5">
                      <Icon name="sparkle" className="h-3.5 w-3.5" />
                      当前避开：{excludedCategories.join(', ')}
                    </div>
                    <div className="mt-1 text-[11px] text-emerald-600/80">新颖度 = 来源(2) + 时效(1) + 分类(1)，满分 4，按分数排序</div>
                  </div>
                  {freshItems.map(item => (
                    <ArticleRow
                      key={item.id}
                      item={item}
                      onSelect={handleArticleSelect}
                      action={typeof item.novelty_score === 'number' ? (
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.novelty_score >= 3 ? 'bg-emerald-100 text-emerald-700' : item.novelty_score >= 2 ? 'bg-indigo-100 text-indigo-600' : 'bg-gray-100 text-gray-500'}`}
                          title="新颖度评分：来源新颖(2) + 24h时效(1) + 分类新颖(1)，最高 4 分"
                        >
                          ✦ {item.novelty_score.toFixed(1)}
                        </span>
                      ) : undefined}
                    />
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

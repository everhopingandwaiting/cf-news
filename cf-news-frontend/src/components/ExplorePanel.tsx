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

  useEffect(() => {
    if (visible) setKeyword(search);
  }, [visible, search]);

  useEffect(() => {
    if (!visible) return;
    setMessage('');
    if (tab === 'timeline') loadTimeline();
    if (tab === 'map') loadMap();
    if (tab === 'fresh') loadFresh();
    if (tab === 'radar') loadRadar();
    if (tab === 'later') loadLater();
  }, [visible, tab]);

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

  if (!visible) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative h-full w-full max-w-xl overflow-y-auto bg-gray-50 shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-gray-200 bg-white/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-gray-900">新闻探索</div>
              <div className="text-[11px] text-gray-400">时间线、地图、雷达和稍后读</div>
            </div>
            <button className="h-8 w-8 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700" onClick={onClose}>x</button>
          </div>
          <div className="mt-3 flex gap-1 overflow-x-auto">
            {[
              ['timeline', '时间线'],
              ['map', '地图'],
              ['radar', '雷达'],
              ['later', '稍后读'],
              ['fresh', '跳出舒适区'],
            ].map(([key, label]) => (
              <button key={key} className={`shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-medium ${tab === key ? 'bg-indigo-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`} onClick={() => setTab(key as Tab)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3 p-4">
          {message && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-700">{message}</div>
          )}

          {tab === 'timeline' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500" value={keyword} onChange={e => setKeyword(e.target.value)} placeholder="输入事件关键词" />
                <button className="rounded-lg bg-indigo-500 px-4 py-2 text-[13px] font-medium text-white hover:bg-indigo-600" onClick={() => loadTimeline(keyword)}>生成</button>
              </div>
              <div className="text-[11px] text-gray-400">按发布时间倒序排列；没有发布时间时使用抓取时间。</div>
              {loading ? <div className="py-10 text-center text-sm text-gray-400">加载中...</div> : timeline.length === 0 ? <div className="py-10 text-center text-sm text-gray-400">暂无时间线</div> : (
                <div className="space-y-2">
                  {timeline.map((event, index) => (
                    <div key={event.id} className="flex gap-3">
                      <div className="flex w-14 shrink-0 flex-col items-center">
                        <div className={`h-2.5 w-2.5 rounded-full ${event.stage === 'latest' ? 'bg-indigo-500' : event.stage === 'first' ? 'bg-emerald-500' : 'bg-gray-300'}`} />
                        {index < timeline.length - 1 && <div className="mt-1 h-full min-h-10 w-px bg-gray-200" />}
                      </div>
                      <button className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white p-3 text-left hover:border-indigo-200" onClick={() => handleArticleSelect(event)}>
                        <div className="text-[11px] text-gray-400">{formatTime(event.time || event.published_at || event.created_at || '')} · 北京时间 · {event.stage === 'first' ? '最早' : event.stage === 'latest' ? '最新' : '进展'}</div>
                        <div className="mt-1 line-clamp-2 text-sm font-medium text-gray-900">{event.title}</div>
                        <div className="mt-1 text-[11px] text-gray-400">{event.source_name || '未知来源'}</div>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {tab === 'map' && (
            loading ? <div className="py-10 text-center text-sm text-gray-400">加载中...</div> : regions.length === 0 ? <div className="py-10 text-center text-sm text-gray-400">暂无地图数据</div> : (
              <div className="space-y-3">
                {regions.map(region => (
                  <div key={region.code} className="rounded-lg border border-gray-200 bg-white p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <div className="text-sm font-semibold text-gray-900">{region.name}</div>
                      <button className="text-[12px] text-indigo-500" onClick={() => { onSearch(region.name); onClose(); }}>{region.count} 条</button>
                    </div>
                    <div className="space-y-1.5">
                      {region.articles.slice(0, 3).map(article => <ArticleRow key={article.id} item={article} onSelect={handleArticleSelect} />)}
                    </div>
                  </div>
                ))}
              </div>
            )
          )}

          {tab === 'radar' && (
            <div className="space-y-3">
              <div className="flex gap-2">
                <input className="min-w-0 flex-1 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:border-indigo-500" value={radarInput} onChange={e => setRadarInput(e.target.value)} placeholder="关注关键词，如 Cloudflare" />
                <button className="rounded-lg bg-indigo-500 px-4 py-2 text-[13px] font-medium text-white hover:bg-indigo-600" onClick={handleAddRadar}>添加</button>
              </div>
              {!token && <button className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-600" onClick={onAuthRequired}>登录后使用雷达</button>}
              {radarKeywords.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {radarKeywords.map(kw => (
                    <button key={kw.id} className="rounded-full bg-white px-2.5 py-1 text-[12px] text-gray-600 ring-1 ring-gray-200 hover:text-red-500" onClick={() => handleRemoveRadar(kw.keyword)}>
                      {kw.keyword} x
                    </button>
                  ))}
                </div>
              )}
              {loading ? <div className="py-10 text-center text-sm text-gray-400">加载中...</div> : radarAlerts.length === 0 ? <div className="py-10 text-center text-sm text-gray-400">暂无命中</div> : radarAlerts.map(alert => (
                <div key={alert.keyword} className="rounded-lg border border-gray-200 bg-white p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <div className="text-sm font-semibold text-gray-900">{alert.keyword}</div>
                    <div className="text-[12px] text-gray-400">{alert.count} 条</div>
                  </div>
                  <div className="space-y-1.5">{alert.articles.map(article => <ArticleRow key={article.id} item={article} onSelect={handleArticleSelect} />)}</div>
                </div>
              ))}
            </div>
          )}

          {tab === 'later' && (
            !token ? <button className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-[13px] text-gray-600" onClick={onAuthRequired}>登录后查看稍后读</button> :
            loading ? <div className="py-10 text-center text-sm text-gray-400">加载中...</div> : laterItems.length === 0 ? <div className="py-10 text-center text-sm text-gray-400">暂无稍后读</div> : (
              <div className="space-y-2">
                {laterItems.map(item => (
                  <ArticleRow key={item.id} item={item} onSelect={handleArticleSelect} action={<button className="shrink-0 rounded-md px-2 py-1 text-[11px] text-gray-400 hover:bg-gray-100 hover:text-red-500" onClick={() => handleRemoveLater(item.id)}>移出</button>} />
                ))}
              </div>
            )
          )}

          {tab === 'fresh' && (
            loading ? <div className="py-10 text-center text-sm text-gray-400">加载中...</div> : freshItems.length === 0 ? <div className="py-10 text-center text-sm text-gray-400">暂无推荐</div> : (
              <div className="space-y-2">
                <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-[12px] text-emerald-700">当前避开：{excludedCategories.join(', ')}</div>
                {freshItems.map(item => <ArticleRow key={item.id} item={item} onSelect={handleArticleSelect} />)}
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

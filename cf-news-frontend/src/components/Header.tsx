import { useState, useRef, useEffect } from 'react';

interface Props {
  user: { username: string } | null;
  refreshing: boolean;
  cooldown: number;
  search: string;
  lang: string;
  sourceCount: number;
  totalNews: number;
  lastFetchedAt: string;
  showManager: boolean;
  showClipboard: boolean;
  sources: { id: number; name: string; language: string }[];
  sourceId: number | null;
  digestEnabled: boolean;
  clipboardHasNew?: boolean;
  onClearClipboardFlag?: () => void;
  onToggleDigest: () => void;
  onExport: () => void;
  onRecommendations: () => void;
  onQA: () => void;
  onLogin: () => void;
  onRegister: () => void;
  onRefresh: () => void;
  onLogout: () => void;
  onSearchChange: (val: string) => void;
  onSearch: () => void;
  onLangChange: (val: string) => void;
  onSourceChange: (id: number | null) => void;
  onManageSources: () => void;
  onToggleClipboard: () => void;
}

export default function Header({ user, refreshing, cooldown, search, lang, sourceCount, totalNews, lastFetchedAt, showManager, showClipboard, sources, sourceId, digestEnabled, clipboardHasNew, onClearClipboardFlag, onToggleDigest, onExport, onRecommendations, onQA, onLogin, onRegister, onRefresh, onLogout, onSearchChange, onSearch, onLangChange, onSourceChange, onManageSources, onToggleClipboard }: Props) {
  const [showMenu, setShowMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const disabled = refreshing || cooldown > 0;
  const btnText = refreshing ? '⟳' : cooldown > 0 ? `⟳${Math.ceil(cooldown / 60)}m` : '⟳';
  const grouped: Record<string, typeof sources> = {};
  sources.forEach(s => { if (!grouped[s.language]) grouped[s.language] = []; grouped[s.language].push(s); });

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setShowMenu(false);
    }
    if (showMenu) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showMenu]);

  return (
    <header className="bg-white border border-gray-200 rounded-2xl px-5 py-3 mb-4 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 bg-gradient-to-br from-indigo-500 to-purple-500 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0 cursor-pointer hover:opacity-85 transition" onClick={onQA} title="AI 问答">✦</div>
          <h1 className="text-base font-semibold text-gray-900 whitespace-nowrap cursor-pointer hover:text-indigo-600 transition" onClick={onQA} title="AI 问答">AI News Hub</h1>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
        {sourceCount > 0 && (
          <button
            className={`hidden sm:inline text-[12px] transition ${user ? 'hover:text-indigo-500 cursor-pointer' : 'text-gray-400 cursor-default'}`}
            onClick={user ? onManageSources : undefined}
            title={user ? (showManager ? '关闭源管理' : '源管理') : undefined}
          >
            📡 {sourceCount}源 · {totalNews > 0 ? totalNews.toLocaleString() : '-'}条
          </button>
        )}
          <button
            className={`w-8 h-8 rounded-lg text-[13px] font-medium transition inline-flex items-center justify-center ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-90'} bg-emerald-500 text-white`}
            onClick={onRefresh} disabled={disabled} title={btnText}>
            {btnText}
          </button>
          <button
            className="relative w-8 h-8 rounded-lg text-[13px] font-medium transition inline-flex items-center justify-center hover:bg-gray-100 text-gray-500"
            onClick={onToggleClipboard} title="共享粘贴板">
            📋{clipboardHasNew && <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-red-500 rounded-full border-2 border-white" />}
          </button>
          {user ? (
            <div className="relative" ref={menuRef}>
              <button
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[13px] text-gray-600 hover:bg-gray-100 transition"
                onClick={() => { const next = !showMenu; setShowMenu(next); if (next) onClearClipboardFlag?.(); }}
              >
                <span className="font-medium">{user.username}</span>
                <span className="text-[10px] text-gray-400">{showMenu ? '▲' : '▼'}</span>
              </button>
              {showMenu && (
                <div className="absolute right-0 top-full mt-1 w-48 bg-white border border-gray-200 rounded-xl shadow-lg py-1.5 z-50 animate-[slideUp_0.15s_ease]">
                  <button className="w-full text-left px-4 py-2 text-[13px] text-gray-700 hover:bg-gray-50 flex items-center gap-2" onClick={() => { onRecommendations(); setShowMenu(false); }}>💡 为你推荐</button>
                  <button className={`w-full text-left px-4 py-2 text-[13px] flex items-center gap-2 ${digestEnabled ? 'text-emerald-600' : 'text-gray-700 hover:bg-gray-50'}`} onClick={() => { onToggleDigest(); setShowMenu(false); }}>📧 {digestEnabled ? '取消每日摘要' : '订阅每日摘要'}</button>
                  <button className="w-full text-left px-4 py-2 text-[13px] text-gray-700 hover:bg-gray-50 flex items-center gap-2" onClick={() => { onExport(); setShowMenu(false); }}>📥 导出收藏</button>
                  <button className={`w-full text-left px-4 py-2 text-[13px] flex items-center gap-2 ${showClipboard ? 'text-indigo-500' : 'text-gray-700 hover:bg-gray-50'}`} onClick={() => { onToggleClipboard(); setShowMenu(false); }}>📋 共享粘贴板{clipboardHasNew && <span className="inline-block w-2 h-2 bg-red-500 rounded-full ml-1" />}</button>
                  <div className="border-t border-gray-100 my-1" />
                  <button className="w-full text-left px-4 py-2 text-[13px] text-gray-400 hover:bg-gray-50 flex items-center gap-2" onClick={() => { onLogout(); setShowMenu(false); }}>退出登录</button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <button className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-transparent text-gray-600 border border-gray-200 hover:bg-gray-50 hover:border-indigo-500 hover:text-indigo-500 transition" onClick={onLogin}>登录</button>
              <button className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-indigo-500 text-white hover:bg-indigo-600 transition" onClick={onRegister}>注册</button>
            </div>
          )}
        </div>
      </div>
      {/* Mobile: source stats + last fetch below the top row */}
      <div className="flex sm:hidden items-center gap-2 mt-1.5">
        {sourceCount > 0 && (
          <button
            className={`text-[11px] transition ${user ? 'hover:text-indigo-500 cursor-pointer' : 'text-gray-400 cursor-default'}`}
            onClick={user ? onManageSources : undefined}
            title={user ? (showManager ? '关闭源管理' : '源管理') : undefined}
          >
            📡 {sourceCount}源 · {totalNews > 0 ? totalNews.toLocaleString() : '-'}条
          </button>
        )}
        {lastFetchedAt && <span className="text-[11px] text-gray-400">⟳ {lastFetchedAt}</span>}
      </div>
      <div className="flex items-center gap-2 mt-2.5 flex-wrap">
        <div className="flex-1 min-w-[180px]">
          <input
            className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-[13px] text-gray-900 outline-none focus:border-indigo-500 focus:bg-white transition placeholder:text-gray-400"
            placeholder="◇ 搜索新闻..." value={search} onChange={e => onSearchChange(e.target.value)} onKeyDown={e => e.key === 'Enter' && onSearch()}
          />
        </div>
        <button className="px-3 py-2 rounded-lg text-[12px] font-medium bg-indigo-500 text-white hover:bg-indigo-600 transition shrink-0" onClick={onSearch}>搜索</button>
        <select
          className="px-2 py-2 bg-gray-50 text-gray-900 border border-gray-200 rounded-lg text-[12px] cursor-pointer outline-none focus:border-indigo-500 focus:bg-white transition"
          value={lang} onChange={e => onLangChange(e.target.value)}>
          <option value="zh">🇨🇳 中文</option>
          <option value="ja">🇯🇵 日本語</option>
          <option value="ko">🇰🇷 한국어</option>
          <option value="en">🌍 EN</option>
          <option value="">所有语言</option>
        </select>
        <select
          className="px-2 py-2 bg-gray-50 text-gray-900 border border-gray-200 rounded-lg text-[12px] cursor-pointer outline-none focus:border-indigo-500 focus:bg-white transition max-w-[130px]"
          value={sourceId ?? ''} onChange={e => onSourceChange(e.target.value ? Number(e.target.value) : null)}>
          <option value="">全部来源</option>
          {Object.entries(grouped).map(([lang, list]) => (
            <optgroup key={lang} label={lang === 'zh' ? '🇨🇳 中文' : lang === 'ja' ? '🇯🇵 日本語' : lang === 'ko' ? '🇰🇷 한국어' : '🌍 英文'}>
              {list.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </optgroup>
          ))}
        </select>
      </div>
    </header>
  );
}

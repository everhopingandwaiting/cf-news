import { useEffect, useState } from 'react';
import type { NewsSource } from '../types';
import api from '../api/client';

interface Props { token: string; onClose: () => void; }

export default function SourceManager({ token: _token, onClose }: Props) {
    const [sources, setSources] = useState<NewsSource[]>([]);
    const [editingId, setEditingId] = useState<number | null>(null);
    const [addingNew, setAddingNew] = useState(false);
    const [name, setName] = useState('');
    const [feedUrl, setFeedUrl] = useState('');
    const [url, setUrl] = useState('');
    const [category, setCategory] = useState('news');
    const [language, setLanguage] = useState('zh');
    const [sortOrder, setSortOrder] = useState(99);
    const [testing, setTesting] = useState<number | null>(null);
    const [fetching, setFetching] = useState<number | null>(null);
    const [deduping, setDeduping] = useState(false);

    const load = async () => { const { data } = await api.get('/api/admin/sources'); setSources(data.sources); };
    useEffect(() => { load(); }, []);

    async function handleSave(id?: number) {
        if (!name || !feedUrl) return;
        const body = { name, url, feed_url: feedUrl, category, language, sort_order: sortOrder };
        if (id) { await api.put(`/api/admin/sources/${id}`, body); }
        else { await api.post('/api/admin/sources', body); }
        setEditingId(null); setAddingNew(false); resetForm(); load();
    }

    async function handleDelete(id: number) {
        if (!confirm('确定删除？')) return;
        await api.delete(`/api/admin/sources/${id}`);
        load();
    }

    async function handleTest(id: number) {
        setTesting(id);
        try { const { data } = await api.post(`/api/admin/sources/${id}/test`); alert(`状态: ${data.status}\n条目数: ${data.items}\n格式: ${data.feed_type}`); }
        catch { alert('测试失败'); }
        setTesting(null);
    }

    async function handleFetch(id: number) {
        setFetching(id);
        try { const { data } = await api.post(`/api/admin/sources/${id}/fetch`); alert(`✅ 抓取完成，新增 ${data.saved} 条`); load(); }
        catch (e: any) { alert('抓取失败: ' + (e?.response?.data?.error || e.message)); }
        setFetching(null);
    }

    async function handleDedup() {
        setDeduping(true);
        try { const { data } = await api.post('/api/admin/sources/dedup'); alert(`已删除 ${data.deleted} 个重复源`); load(); }
        catch { alert('去重失败'); }
        setDeduping(false);
    }

    function editSource(s: NewsSource) {
        setAddingNew(false);
        if (editingId === s.id) { setEditingId(null); return; }
        setEditingId(s.id); setName(s.name); setFeedUrl(s.feed_url); setUrl(s.url || '');
        setCategory(s.category || 'news'); setLanguage(s.language);
        setSortOrder(s.sort_order ?? 99);
    }
    function startAdd() {
        setEditingId(null); setAddingNew(true); resetForm();
    }
    function resetForm() { setName(''); setFeedUrl(''); setUrl(''); setCategory('news'); setLanguage('zh'); setSortOrder(99); }

    return (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] border border-gray-200 shadow-xl animate-[slideUp_0.25s_ease] flex flex-col">
                <div className="flex items-center justify-between p-6 pb-4 border-b border-gray-200">
                    <h2 className="text-lg font-semibold text-gray-900">📡 新闻源管理 ({sources.length})</h2>
                    <div className="flex gap-2">
                        <button className="px-4 py-2 bg-indigo-500 text-white rounded-lg text-[13px] font-medium hover:bg-indigo-600 transition" onClick={startAdd}>+ 新增</button>
                        <button className="px-4 py-2 rounded-lg text-[13px] font-medium border border-gray-200 text-gray-500 hover:bg-gray-50 transition disabled:opacity-50" onClick={handleDedup} disabled={deduping}>{deduping ? '处理中…' : '去重'}</button>
                        <button className="w-9 h-9 rounded-full bg-gray-100 border border-gray-200 text-gray-400 cursor-pointer text-base flex items-center justify-center hover:bg-gray-200 hover:text-gray-600 transition" onClick={onClose}>✕</button>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-6 pt-4 space-y-3" style={{ scrollbarWidth: 'thin' }}>
                    {addingNew && (
                        <div className="bg-white border border-indigo-300 rounded-xl p-4 space-y-3 shadow-sm">
                            <div className="grid grid-cols-[1fr_1fr_80px] gap-3">
                                <div>
                                    <label className="block mb-1 text-gray-400 text-[11px]">名称</label>
                                    <input className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500" value={name} onChange={e => setName(e.target.value)} />
                                </div>
                                <div>
                                    <label className="block mb-1 text-gray-400 text-[11px]">分类</label>
                                    <select className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500" value={category} onChange={e => setCategory(e.target.value)}>
                                        <option value="news">新闻</option><option value="tech">科技</option><option value="ai">AI</option><option value="finance">财经</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block mb-1 text-gray-400 text-[11px]">语言</label>
                                    <select className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500" value={language} onChange={e => setLanguage(e.target.value)}>
                                        <option value="zh">中文</option><option value="en">英文</option><option value="ja">日语</option><option value="ko">韩语</option>
                                    </select>
                                </div>
                            </div>
                            <div>
                                <label className="block mb-1 text-gray-400 text-[11px]">订阅地址</label>
                                <input className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500" value={feedUrl} onChange={e => setFeedUrl(e.target.value)} placeholder="https://example.com/rss" />
                            </div>
                            <div className="grid grid-cols-[1fr_80px] gap-3">
                                <div>
                                    <label className="block mb-1 text-gray-400 text-[11px]">网站</label>
                                    <input className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500" value={url} onChange={e => setUrl(e.target.value)} />
                                </div>
                                <div>
                                    <label className="block mb-1 text-gray-400 text-[11px]">排序</label>
                                    <input type="number" className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))} />
                                </div>
                            </div>
                            <div className="flex gap-2 pt-1">
                                <button className="px-4 py-2 bg-indigo-500 text-white rounded-lg text-[12px] font-medium hover:bg-indigo-600 transition" onClick={() => handleSave()}>添加</button>
                                <button className="px-4 py-2 rounded-lg text-[12px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 transition" onClick={() => setAddingNew(false)}>取消</button>
                            </div>
                        </div>
                    )}

                    {sources.map(s => {
                        const editing = editingId === s.id;
                        return (
                        <div key={s.id} className={`rounded-xl border transition-all duration-150 ${editing ? 'bg-white border-indigo-300 shadow-sm' : 'bg-gray-50 border-gray-200'}`}>
                            {editing ? (
                            <div className="p-4 space-y-3">
                                <div className="grid grid-cols-[1fr_1fr_80px] gap-3">
                                    <div>
                                        <label className="block mb-1 text-gray-400 text-[11px]">名称</label>
                                        <input className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500" value={name} onChange={e => setName(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block mb-1 text-gray-400 text-[11px]">分类</label>
                                        <select className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500" value={category} onChange={e => setCategory(e.target.value)}>
                                            <option value="news">新闻</option><option value="tech">科技</option><option value="ai">AI</option><option value="finance">财经</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block mb-1 text-gray-400 text-[11px]">语言</label>
                                        <select className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500" value={language} onChange={e => setLanguage(e.target.value)}>
                                            <option value="zh">中文</option><option value="en">英文</option><option value="ja">日语</option><option value="ko">韩语</option>
                                        </select>
                                    </div>
                                </div>
                                <div>
                                    <label className="block mb-1 text-gray-400 text-[11px]">订阅地址</label>
                                    <input className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500" value={feedUrl} onChange={e => setFeedUrl(e.target.value)} placeholder="https://example.com/rss" />
                                </div>
                                <div className="grid grid-cols-[1fr_80px] gap-3">
                                    <div>
                                        <label className="block mb-1 text-gray-400 text-[11px]">网站</label>
                                        <input className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500" value={url} onChange={e => setUrl(e.target.value)} />
                                    </div>
                                    <div>
                                        <label className="block mb-1 text-gray-400 text-[11px]">排序</label>
                                        <input type="number" className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500" value={sortOrder} onChange={e => setSortOrder(Number(e.target.value))} />
                                    </div>
                                </div>
                                <div className="flex gap-2 pt-1">
                                    <button className="px-4 py-2 bg-indigo-500 text-white rounded-lg text-[12px] font-medium hover:bg-indigo-600 transition" onClick={() => handleSave(s.id)}>保存</button>
                                    <button className="px-4 py-2 rounded-lg text-[12px] font-medium border border-gray-200 bg-transparent text-gray-600 hover:bg-gray-50 transition" onClick={() => setEditingId(null)}>取消</button>
                                </div>
                            </div>
                            ) : (
                            <div className="flex items-center justify-between p-4">
                                <div className="flex items-center gap-2 flex-wrap text-sm min-w-0">
                                    <span className="font-semibold text-gray-900">{s.name}</span>
                                    <span className="px-1.5 py-0.5 rounded text-[11px] bg-indigo-100 text-indigo-600">{s.language}</span>
                                    <span className="px-1.5 py-0.5 rounded text-[11px] bg-emerald-100 text-emerald-600">{s.category}</span>
                                    <span className="text-gray-400 text-[12px] truncate max-w-[160px]">{s.feed_url}</span>
                                    {s.last_fetched_at && <span className="text-gray-400 text-[11px]">上次: {s.last_fetched_at.substring(0, 16)}</span>}
                                    {s.last_fetched_at && <span className="text-gray-400 text-[11px]">新增: <span className={s.last_fetched_count > 0 ? 'text-emerald-500 font-medium' : 'text-gray-400'}>{s.last_fetched_count ?? 0}条</span></span>}
                                    <span className="text-gray-400 text-[11px]">当日: <span className={s.today_count > 0 ? 'text-indigo-500 font-medium' : 'text-gray-400'}>{s.today_count ?? 0}条</span></span>
                                </div>
                                <div className="flex gap-1 shrink-0">
                                    <button className="px-2.5 py-1.5 rounded-lg text-[12px] text-emerald-600 hover:bg-emerald-50 transition disabled:opacity-40" onClick={() => handleFetch(s.id)} disabled={fetching === s.id}>{fetching === s.id ? '⟳' : '⟳刷新'}</button>
                                    <button className="px-2.5 py-1.5 rounded-lg text-[12px] text-gray-500 hover:bg-gray-200 transition" onClick={() => handleTest(s.id)} disabled={testing === s.id}>{testing === s.id ? '...' : '测试'}</button>
                                    <button className="px-2.5 py-1.5 rounded-lg text-[12px] text-gray-500 hover:bg-gray-200 transition" onClick={() => editSource(s)}>编辑</button>
                                    <button className="px-2.5 py-1.5 rounded-lg text-[12px] text-red-500 hover:bg-red-50 transition" onClick={() => handleDelete(s.id)}>删除</button>
                                </div>
                            </div>
                            )}
                        </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
}

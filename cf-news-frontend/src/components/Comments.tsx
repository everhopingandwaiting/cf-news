import { useState, useEffect, useRef, useCallback } from 'react';
import type { NewsComment } from '../types';
import { getComments, postComment } from '../api/client';

interface Props { newsId: number; token: string | null; }

export default function Comments({ newsId, token }: Props) {
  const [comments, setComments] = useState<NewsComment[]>([]);
  const [text, setText] = useState('');
  const wsRef = useRef<WebSocket | null>(null);

  // Load initial comments via REST for unauthenticated users (read-only, no polling)
  useEffect(() => {
    if (!token) {
      getComments(newsId).then(setComments).catch(() => {});
    }
  }, [newsId, token]);

  // WebSocket for authenticated users: real-time loading + posting
  useEffect(() => {
    if (!token) return;
    const t = token;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${location.host}/api/comments/ws?newsId=${newsId}&token=${encodeURIComponent(t)}`);

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'comments') {
            setComments(msg.comments);
          } else if (msg.type === 'new_comment') {
            setComments(prev => [...prev, msg.comment]);
          } else if (msg.type === 'delete') {
            setComments(prev => prev.filter(c => c.id !== msg.commentId));
          }
        } catch {}
      };

      ws.onclose = () => {
        if (!disposed) reconnectTimer = setTimeout(connect, 5000);
      };

      ws.onerror = () => ws.close();
      wsRef.current = ws;
    }

    connect();
    return () => {
      disposed = true;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [newsId, token]);

  const handleSubmit = useCallback(async () => {
    const content = text.trim();
    if (!content) return;
    setText('');

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'create', content }));
      return;
    }

    // Fallback to REST if WS not available
    try {
      await postComment(newsId, content);
      const updated = await getComments(newsId);
      setComments(updated);
    } catch {}
  }, [text, newsId]);

  return (
    <div className="mt-3.5 pt-3.5 border-t border-gray-200">
      <h4 className="mb-2.5 text-[13px] text-gray-400 font-medium">⌨ 评论 ({comments.length})</h4>
      <div className="space-y-1.5">
        {comments.map(c => (
          <div key={c.id} className="bg-gray-50 px-3 py-2.5 rounded-lg border border-gray-200">
            <div className="flex justify-between mb-1"><span className="font-semibold text-[12px] text-indigo-500">{c.username}</span><span className="text-[11px] text-gray-400">{(c.created_at || '').substring(0, 16)}</span></div>
            <div className="text-[13px] text-gray-600">{c.content}</div>
          </div>
        ))}
        {comments.length === 0 && <p className="text-gray-400 text-[13px] py-2.5 text-center">暂无评论</p>}
      </div>
      {token && (
        <div className="flex gap-2 mt-2.5">
          <input className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-[13px] text-gray-900 outline-none focus:border-indigo-500" value={text} onChange={e => setText(e.target.value)} placeholder="发表评论..." onKeyDown={e => e.key === 'Enter' && handleSubmit()} />
          <button className="px-3.5 py-2 bg-indigo-500 text-white rounded-lg text-[13px] font-medium hover:bg-indigo-600 transition disabled:opacity-40 disabled:cursor-not-allowed" onClick={handleSubmit} disabled={!text.trim()}>发送</button>
        </div>
      )}
    </div>
  );
}

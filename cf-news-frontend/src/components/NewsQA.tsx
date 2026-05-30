import { useState, useRef, useEffect } from 'react';
import { askQuestionStream } from '../api/client';

interface Props {
  visible: boolean;
  onClose: () => void;
  token: string | null;
}

interface Message {
  role: 'user' | 'ai';
  content: string;
}

export default function NewsQA({ visible, onClose, token }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    { role: 'ai', content: '你好！我是 AI 新闻助手，你可以问我关于新闻的任何问题。' },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (visible && inputRef.current) {
      inputRef.current.focus();
    }
  }, [visible]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streaming]);

  async function handleSend() {
    const q = input.trim();
    if (!q || loading || streaming) return;

    if (!token) {
      setError('请先登录');
      return;
    }

    setError('');
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: q }]);
    setLoading(true);

    try {
      const response = await askQuestionStream(q);

      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '请求失败' }));
        setMessages(prev => [...prev, { role: 'ai', content: err.error || '抱歉，出错了' }]);
        setLoading(false);
        return;
      }

      setLoading(false);
      setStreaming(true);
      setMessages(prev => [...prev, { role: 'ai', content: '' }]);

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No reader');

      const decoder = new TextDecoder();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ') && line !== 'data: [DONE]') {
            try {
              const json = JSON.parse(line.substring(6));
              const delta = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || '';
              if (delta) {
                setMessages(prev => {
                  const next = [...prev];
                  const last = next[next.length - 1];
                  if (last.role === 'ai') {
                    next[next.length - 1] = { ...last, content: last.content + delta };
                  }
                  return next;
                });
              }
            } catch {}
          }
        }
      }

      setStreaming(false);
    } catch {
      setMessages(prev => [...prev, { role: 'ai', content: '抱歉，出错了，请重试' }]);
      setLoading(false);
      setStreaming(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  if (!visible) return null;

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full max-w-[480px] max-h-[75vh] sm:max-h-[80vh] border border-gray-200 shadow-xl animate-[slideUp_0.25s_ease] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-lg">✦</span>
            <span className="font-semibold text-[15px] text-gray-800">AI 问答</span>
          </div>
          <button className="w-8 h-8 rounded-full bg-gray-100 text-gray-400 cursor-pointer text-sm flex items-center justify-center hover:bg-gray-200 hover:text-gray-600 transition" onClick={onClose}>✕</button>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {messages.map((msg, i) => (
            <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                  msg.role === 'user'
                    ? 'bg-indigo-500 text-white rounded-br-md'
                    : 'bg-gray-100 text-gray-700 rounded-bl-md'
                }`}
              >
                {msg.content}
                {streaming && i === messages.length - 1 && (
                  <span className="inline-block w-1.5 h-4 bg-current ml-0.5 animate-pulse" />
                )}
              </div>
            </div>
          ))}
          {loading && !streaming && (
            <div className="flex justify-start">
              <div className="bg-gray-100 text-gray-700 px-4 py-2.5 rounded-2xl rounded-bl-md text-sm">
                <span className="inline-flex gap-1">
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '200ms' }} />
                  <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '400ms' }} />
                </span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Error */}
        {error && <p className="px-5 pb-1 text-[12px] text-red-400">{error}</p>}

        {/* Input */}
        <div className="px-5 py-3 border-t border-gray-100 shrink-0">
          <div className="flex gap-2">
            <input
              ref={inputRef}
              type="text"
              className="flex-1 px-4 py-2.5 rounded-lg border border-gray-200 text-sm text-gray-700 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-200 transition placeholder:text-gray-400"
              placeholder="输入你关心的问题..."
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={loading}
            />
            <button
              className="px-5 py-2.5 bg-indigo-500 text-white rounded-lg text-[13px] font-medium hover:bg-indigo-600 transition disabled:opacity-40 disabled:cursor-not-allowed shrink-0"
              onClick={handleSend}
              disabled={loading || streaming || !input.trim()}
            >
              {loading ? '...' : '发送'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

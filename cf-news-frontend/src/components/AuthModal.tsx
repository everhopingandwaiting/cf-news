import { useState, useEffect, useRef, type FormEvent } from 'react';
import { login, register } from '../api/client';

interface Props {
  visible: boolean;
  onClose: () => void;
  onLoginSuccess: (token: string) => void;
}

type Mode = 'login' | 'register';

export default function AuthModal({ visible, onClose, onLoginSuccess }: Props) {
  const [mode, setMode] = useState<Mode>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const turnstileRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const turnstileTokenRef = useRef('');
  const turnstileResolveRef = useRef<((token: string) => void) | null>(null);

  // Render Turnstile widget after we have the site key
  useEffect(() => {
    if (!visible) return;
    fetch('/api/config').then(r => r.json()).then(c => {
      if (c.turnstileSiteKey && turnstileRef.current && !widgetIdRef.current) {
        widgetIdRef.current = (window as any).turnstile?.render(turnstileRef.current, {
          sitekey: c.turnstileSiteKey,
          callback: (token: string) => {
            turnstileTokenRef.current = token;
            if (turnstileResolveRef.current) {
              turnstileResolveRef.current(token);
              turnstileResolveRef.current = null;
            }
          },
        });
      }
    }).catch(() => {});
    return () => {
      if (widgetIdRef.current) {
        try { (window as any).turnstile?.remove(widgetIdRef.current); } catch {}
        widgetIdRef.current = null;
      }
      turnstileTokenRef.current = '';
    };
  }, [visible]);

  if (!visible) return null;

  // The widget is Invisible mode: render() alone produces no token. It only
  // issues one after execute() (the submit click is the user interaction), so
  // wait for the callback before proceeding. Guard against a hung widget so the
  // submit button never spins forever.
  async function ensureTurnstileToken(): Promise<string> {
    if (turnstileTokenRef.current) return turnstileTokenRef.current;
    if (!widgetIdRef.current) return '';
    return new Promise(resolve => {
      const timer = setTimeout(() => { turnstileResolveRef.current = null; resolve(''); }, 5000);
      turnstileResolveRef.current = (token: string) => { clearTimeout(timer); resolve(token); };
      (window as any).turnstile?.execute(widgetIdRef.current);
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const token = await ensureTurnstileToken();
    if (!token) {
      setError('人机验证加载失败，请刷新页面重试');
      setLoading(false);
      return;
    }
    try {
      if (mode === 'register') {
        await register(username, email, password, token);
        setMode('login'); setUsername(''); setPassword('');
      } else {
        const data = await login(email, password, token);
        localStorage.setItem('token', data.token);
        onLoginSuccess(data.token);
        onClose();
      }
    } catch (err: any) { setError(err.response?.data?.error || '操作失败'); }
    setLoading(false);
  }

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-lg p-8 w-full max-w-sm border border-gray-200 shadow-xl animate-[slideUp_0.25s_ease]">
        <h2 className="text-xl font-semibold mb-6 text-center text-gray-900">{mode === 'login' ? '用户登录' : '用户注册'}</h2>
        <form onSubmit={handleSubmit}>
          {mode === 'register' && (
            <div className="mb-4">
              <label className="block mb-1.5 text-gray-400 text-[13px]">用户名</label>
              <input className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20" value={username} onChange={e => setUsername(e.target.value)} placeholder="你的昵称" required />
            </div>
          )}
          <div className="mb-4">
            <label className="block mb-1.5 text-gray-400 text-[13px]">邮箱地址</label>
            <input type="email" className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20" value={email} onChange={e => setEmail(e.target.value)} placeholder="your@email.com" required />
          </div>
          <div className="mb-4">
            <label className="block mb-1.5 text-gray-400 text-[13px]">密码</label>
            <input type="password" className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500/20" value={password} onChange={e => setPassword(e.target.value)} placeholder="输入密码" required />
          </div>
          {error && <div className="text-red-500 text-[13px] text-center mb-3">{error}</div>}
          <div ref={turnstileRef} className="mb-3 flex justify-center" />
          <button type="submit" disabled={loading} className="w-full py-3 rounded-lg bg-indigo-500 text-white font-medium text-sm hover:bg-indigo-600 transition disabled:opacity-50">{loading ? '处理中...' : mode === 'login' ? '登录' : '注册'}</button>
        </form>
        <div className="text-center mt-4 text-gray-400 text-[13px]">
          {mode === 'login' ? <>还没有账号？ <a className="text-indigo-500 cursor-pointer font-medium" onClick={() => { setMode('register'); setError(''); }}>立即注册</a></>
            : <>已有账号？ <a className="text-indigo-500 cursor-pointer font-medium" onClick={() => { setMode('login'); setError(''); }}>去登录</a></>}
        </div>
      </div>
    </div>
  );
}

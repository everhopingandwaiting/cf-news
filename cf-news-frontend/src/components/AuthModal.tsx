import { useState, useEffect, useRef, type FormEvent } from 'react';
import { login, register } from '../api/client';

interface Props {
  visible: boolean;
  onClose: () => void;
  onLoginSuccess: (token: string) => void;
}

type Mode = 'login' | 'register';

// 轮询等待 index.html 异步加载的 Turnstile 脚本就绪；超时静默返回（由调用方按
// best-effort 降级），避免弱网/广告拦截下 window.turnstile 永远 undefined。
function waitForTurnstileScript(timeoutMs: number): Promise<void> {
  return new Promise(resolve => {
    const start = Date.now();
    const tick = () => {
      const ts = (window as any).turnstile;
      if (ts && typeof ts.render === 'function') return resolve();
      if (Date.now() - start >= timeoutMs) return resolve();
      setTimeout(tick, 100);
    };
    tick();
  });
}

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

  // Render Turnstile widget after we have the site key AND the async script is
  // ready. 之前直接 `window.turnstile?.render`：脚本未就绪时静默跳过、永不重试，
  // 提交必然失败。现在脚本与 /api/config 并行等待（各 8s 上限），渲染加 try/catch。
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const setup = async () => {
      const [cfg] = await Promise.all([
        fetch('/api/config').then(r => r.json()).catch(() => null),
        waitForTurnstileScript(8000),
      ]);
      const ts = (window as any).turnstile;
      if (cancelled || !cfg?.turnstileSiteKey || !ts || !turnstileRef.current || widgetIdRef.current) return;
      try {
        widgetIdRef.current = ts.render(turnstileRef.current, {
          sitekey: cfg.turnstileSiteKey,
          callback: (token: string) => {
            turnstileTokenRef.current = token;
            if (turnstileResolveRef.current) {
              turnstileResolveRef.current(token);
              turnstileResolveRef.current = null;
            }
          },
        }) || null;
      } catch {
        widgetIdRef.current = null;
      }
    };
    setup();
    return () => {
      cancelled = true;
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
  // submit button never spins forever. 返回 '' 表示拿不到 token（脚本被拦截/
  // widget 未就绪/挑战超时）——按 best-effort 语义交由调用方降级放行，不阻塞登录。
  async function ensureTurnstileToken(): Promise<string> {
    if (turnstileTokenRef.current) return turnstileTokenRef.current;
    const ts = (window as any).turnstile;
    if (!ts) return ''; // 脚本未加载（弱网/广告拦截）：直接降级，不白等
    // widget 可能仍在等 /api/config 或脚本，提交时最多再等 3s 就绪
    const deadline = Date.now() + 3000;
    while (!widgetIdRef.current && Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 100));
    }
    if (!widgetIdRef.current) return '';
    return new Promise(resolve => {
      // 挑战网络差时 5s 经常不够（CF APAC 劣化实测），放宽到 12s
      const timer = setTimeout(() => { turnstileResolveRef.current = null; resolve(''); }, 12000);
      turnstileResolveRef.current = (token: string) => { clearTimeout(timer); resolve(token); };
      try { ts.execute(widgetIdRef.current); } catch { clearTimeout(timer); turnstileResolveRef.current = null; resolve(''); }
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    const token = await ensureTurnstileToken();
    // Turnstile best-effort（与 auth.ts 登录/注册语义一致）：拿得到 token 就带上、
    // 由后端强校验 siteverify；拿不到不阻塞——验证服务弱网/被拦截时不应锁死用户。
    try {
      if (mode === 'register') {
        await register(username, email, password, token || undefined);
        setMode('login'); setUsername(''); setPassword('');
      } else {
        const data = await login(email, password, token || undefined);
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

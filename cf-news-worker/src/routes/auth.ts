import { Hono } from 'hono';
import { Bindings, User, JWTPayload } from '../types';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { users, appConfig } from '../db/schema';

const auth = new Hono<{ Bindings: Bindings }>();

async function hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

async function generateJWT(user: User, secret: string): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload: JWTPayload = {
        sub: user.id,
        email: user.email,
        role: user.role || 'user',
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60,
    };
    const encoder = new TextEncoder();
    const headerBase64 = btoa(JSON.stringify(header));
    const payloadBase64 = btoa(JSON.stringify(payload));
    const message = `${headerBase64}.${payloadBase64}`;
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
    return `${message}.${signatureBase64}`;
}

async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
    try {
        const [headerBase64, payloadBase64, signatureBase64] = token.split('.');
        const encoder = new TextEncoder();
        const message = `${headerBase64}.${payloadBase64}`;
        const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
        const signature = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
        const valid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(message));
        if (!valid) return null;
        const payload = JSON.parse(atob(payloadBase64)) as JWTPayload;
        if (payload.exp < Math.floor(Date.now() / 1000)) return null;
        return payload;
    } catch (e) {
        console.error('JWT verification failed:', e);
        return null;
    }
}

auth.post('/register', async (c) => {
    const { email, password, username, turnstileToken } = await c.req.json();

    // Turnstile is best-effort: if a token is present it MUST verify, but a
    // missing token does not block auth (the invisible widget occasionally
    // fails to produce one, and blocking would lock real users out). Login
    // brute-force protection is enforced separately via the fail counter.
    if (turnstileToken) {
        const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body: `secret=${c.env.TURNSTILE_SECRET}&response=${turnstileToken}`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        const outcome = await verify.json<any>();
        if (!outcome.success) return c.json({ error: '验证失败，请重试' }, 403);
    }

    if (!email || !password) return c.json({ error: '邮箱和密码必填' }, 400);

    const db = getDb(c.env);
    const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).get();

    if (existing) return c.json({ error: '该邮箱已注册' }, 409);

    const password_hash = await hashPassword(password);
    const uname = username || email.split('@')[0];

    await db.insert(users).values({ email, password_hash, username: uname, role: 'user' });

    const created = await db.select().from(users).where(eq(users.email, email)).get();

    const user: User = {
        id: created!.id,
        email,
        password_hash,
        username: uname,
        role: 'user',
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    const token = await generateJWT(user, c.env.JWT_SECRET);
    return c.json({ message: '注册成功', token, user: { id: user.id, email: user.email, username: user.username, role: user.role } }, 201);
});

const LOGIN_LOCK_PREFIX = 'login:fail:';
const LOGIN_MAX_ATTEMPTS = 5;

auth.post('/login', async (c) => {
    const { email, password, turnstileToken } = await c.req.json();

    // Best-effort Turnstile (see register): token present => must verify,
    // missing => allowed. Brute force is blocked by the fail counter below.
    if (turnstileToken) {
        const verify = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
            method: 'POST',
            body: `secret=${c.env.TURNSTILE_SECRET}&response=${turnstileToken}`,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        });
        const outcome = await verify.json<any>();
        if (!outcome.success) return c.json({ error: '验证失败，请重试' }, 403);
    }

    if (!email || !password) return c.json({ error: '邮箱和密码必填' }, 400);

    const lockKey = LOGIN_LOCK_PREFIX + email.toLowerCase().trim();
    const db = getDb(c.env);

    const lockRow = await db.select({ value: appConfig.value })
        .from(appConfig).where(eq(appConfig.key, lockKey)).get();
    const failCount = parseInt(lockRow?.value || '0');
    if (failCount >= LOGIN_MAX_ATTEMPTS) {
        return c.json({ error: '登录失败次数过多，请 15 分钟后再试' }, 429);
    }

    const userRow = await db.select().from(users).where(eq(users.email, email)).get();
    if (!userRow) return c.json({ error: '邮箱或密码错误' }, 401);

    const password_hash = await hashPassword(password);
    if (password_hash !== userRow.password_hash) {
        await db.insert(appConfig).values({ key: lockKey, value: String(failCount + 1) })
            .onConflictDoUpdate({ target: appConfig.key, set: { value: String(failCount + 1) } });
        return c.json({ error: '邮箱或密码错误' }, 401);
    }

    await db.delete(appConfig).where(eq(appConfig.key, lockKey));

    const user: User = {
        id: userRow.id,
        email: userRow.email,
        password_hash: userRow.password_hash,
        username: userRow.username || undefined,
        role: userRow.role || 'user',
        created_at: userRow.created_at || '',
        updated_at: userRow.updated_at || '',
    };

    const token = await generateJWT(user, c.env.JWT_SECRET);
    return c.json({ message: '登录成功', token, user: { id: user.id, email: user.email, username: user.username } });
});

auth.get('/me', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) return c.json({ error: '未授权' }, 401);

    const token = authHeader.substring(7);
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    if (!payload) return c.json({ error: 'Token 无效或已过期' }, 401);

    const db = getDb(c.env);
    const userRow = await db.select({ id: users.id, email: users.email, username: users.username, created_at: users.created_at })
        .from(users).where(eq(users.id, payload.sub)).get();

    if (!userRow) return c.json({ error: '用户不存在' }, 404);
    return c.json({ user: userRow });
});

export default auth;
export { verifyJWT };

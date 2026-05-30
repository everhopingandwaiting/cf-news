import { Hono } from 'hono';
import { Bindings, User, JWTPayload } from '../types';

const auth = new Hono<{ Bindings: Bindings }>();

// Helper function to hash password using Web Crypto API
async function hashPassword(password: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hash = await crypto.subtle.digest('SHA-256', data);
    return btoa(String.fromCharCode(...new Uint8Array(hash)));
}

// Helper function to generate JWT
async function generateJWT(user: User, secret: string): Promise<string> {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload: JWTPayload = {
        sub: user.id,
        email: user.email,
        exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60, // 7 days
    };

    const encoder = new TextEncoder();
    const headerBase64 = btoa(JSON.stringify(header));
    const payloadBase64 = btoa(JSON.stringify(payload));
    const message = `${headerBase64}.${payloadBase64}`;

    const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
    );

    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
    const signatureBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)));

    return `${message}.${signatureBase64}`;
}

// Helper function to verify JWT
async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
    try {
        const [headerBase64, payloadBase64, signatureBase64] = token.split('.');
        
        const encoder = new TextEncoder();
        const message = `${headerBase64}.${payloadBase64}`;

        const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['verify']
        );

        const signature = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
        const valid = await crypto.subtle.verify(
            'HMAC',
            key,
            signature,
            encoder.encode(message)
        );

        if (!valid) return null;

        const payload = JSON.parse(atob(payloadBase64)) as JWTPayload;
        if (payload.exp < Math.floor(Date.now() / 1000)) return null;

        return payload;
    } catch {
        return null;
    }
}

// Register
auth.post('/register', async (c) => {
    const { email, password, username } = await c.req.json();

    if (!email || !password) {
        return c.json({ error: '邮箱和密码必填' }, 400);
    }

    // Check if user exists
    const existing = await c.env.DB.prepare(
        'SELECT id FROM users WHERE email = ?'
    ).bind(email).first();

    if (existing) {
        return c.json({ error: '该邮箱已注册' }, 409);
    }

    const password_hash = await hashPassword(password);
    
    const result = await c.env.DB.prepare(
        'INSERT INTO users (email, password_hash, username) VALUES (?, ?, ?)'
    ).bind(email, password_hash, username || email.split('@')[0]).run();

    const user: User = {
        id: result.meta.last_row_id as number,
        email,
        password_hash,
        username: username || email.split('@')[0],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
    };

    const token = await generateJWT(user, c.env.JWT_SECRET);

    return c.json({
        message: '注册成功',
        token,
        user: { id: user.id, email: user.email, username: user.username },
    }, 201);
});

const LOGIN_LOCK_PREFIX = 'login:fail:';
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_LOCK_TTL = 900; // 15 minutes

// Login
auth.post('/login', async (c) => {
    const { email, password } = await c.req.json();

    if (!email || !password) {
        return c.json({ error: '邮箱和密码必填' }, 400);
    }

    // Check brute-force lock
    const lockKey = LOGIN_LOCK_PREFIX + email.toLowerCase().trim();
    const failCount = parseInt(await c.env.KV.get(lockKey) || '0');
    if (failCount >= LOGIN_MAX_ATTEMPTS) {
        return c.json({ error: '登录失败次数过多，请 15 分钟后再试' }, 429);
    }

    const user = await c.env.DB.prepare(
        'SELECT * FROM users WHERE email = ?'
    ).bind(email).first<User>();

    if (!user) {
        return c.json({ error: '邮箱或密码错误' }, 401);
    }

    const password_hash = await hashPassword(password);
    if (password_hash !== user.password_hash) {
        // Record failed attempt
        await c.env.KV.put(lockKey, String(failCount + 1), { expirationTtl: LOGIN_LOCK_TTL });
        return c.json({ error: '邮箱或密码错误' }, 401);
    }

    // Clear lock on success
    await c.env.KV.delete(lockKey).catch(() => {});

    const token = await generateJWT(user, c.env.JWT_SECRET);

    return c.json({
        message: '登录成功',
        token,
        user: { id: user.id, email: user.email, username: user.username },
    });
});

// Get current user profile
auth.get('/me', async (c) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return c.json({ error: '未授权' }, 401);
    }

    const token = authHeader.substring(7);
    const payload = await verifyJWT(token, c.env.JWT_SECRET);

    if (!payload) {
        return c.json({ error: 'Token 无效或已过期' }, 401);
    }

    const user = await c.env.DB.prepare(
        'SELECT id, email, username, created_at FROM users WHERE id = ?'
    ).bind(payload.sub).first();

    if (!user) {
        return c.json({ error: '用户不存在' }, 404);
    }

    return c.json({ user });
});

export default auth;
export { verifyJWT };
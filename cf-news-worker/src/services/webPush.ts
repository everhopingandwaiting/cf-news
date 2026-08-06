import { Bindings } from '../types';

/**
 * Web Push 通知发送（纯 WebCrypto 实现，无任何 npm 依赖）
 *
 * 协议：
 *   1. VAPID (RFC 8292) — ES256 签名的 JWT，放在 `Authorization: vapid t=...,k=...` 头里
 *      用于向推送服务（Mozilla autopush / FCM / Apple）认证应用服务器身份
 *   2. 载荷加密 (RFC 8291 + RFC 8188 aes128gcm) — ECDH 派生共享密钥，
 *      HKDF-SHA256 派生 CEK/NONCE，AES-128-GCM 加密 JSON 载荷
 *
 * 所有 crypto / fetch 失败都吞掉并返回 false，绝不让异常冒泡到调用方。
 */

const VAPID_SUBJECT = 'mailto:admin@slivermoss.site'; // JWT sub 字段，邮件格式是规范要求的
const VAPID_TOKEN_TTL_SECONDS = 12 * 3600;            // VAPID JWT 有效期 12 小时
const PUSH_TTL_HEADER = '86400';                      // 推送服务保留消息 24 小时（离线时也能收到）
const RECORD_SIZE = 4096;                             // aes128gcm 记录大小（RFC 8188）
const TARGET_PADDED_LENGTH = 400;                     // 隐私填充目标长度：~200B JSON 填充到 ~400B
const FETCH_TIMEOUT_MS = 15000;                       // 单条推送超时，避免拖垮整个 cron

const encoder = new TextEncoder();

// ---------- 基础编码工具 ----------

const B64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** 字节数组 → base64url（无 Buffer，纯手写，Workers 安全） */
export function base64UrlEncode(bytes: Uint8Array): string {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
        const b0 = bytes[i];
        const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
        const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
        out += B64_CHARS[b0 >> 2];
        out += B64_CHARS[((b0 & 3) << 4) | (b1 >> 4)];
        out += i + 1 < bytes.length ? B64_CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '';
        out += i + 2 < bytes.length ? B64_CHARS[b2 & 63] : '';
    }
    // base64 → base64url：替换 + 和 /，去掉 = 填充
    return out.replace(/\+/g, '-').replace(/\//g, '_');
}

/** base64url → 字节数组（无 atob，纯查表实现） */
function base64UrlDecode(s: string): Uint8Array {
    // 建 128 格查表；非法字符（含 '='）都映射到 0，出现在末尾填充位时不影响结果
    const lookup = new Uint8Array(128);
    for (let i = 0; i < 64; i++) lookup[B64_CHARS.charCodeAt(i)] = i;
    let b64 = s.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4 !== 0) b64 += '=';
    const out = new Uint8Array((b64.length / 4) * 3);
    let o = 0;
    for (let i = 0; i < b64.length; i += 4) {
        const n = (lookup[b64.charCodeAt(i)] << 18)
            | (lookup[b64.charCodeAt(i + 1)] << 12)
            | (lookup[b64.charCodeAt(i + 2)] << 6)
            | lookup[b64.charCodeAt(i + 3)];
        out[o++] = (n >> 16) & 0xff;
        out[o++] = (n >> 8) & 0xff;
        out[o++] = n & 0xff;
    }
    // 去掉 '=' 填充引入的多余字节
    let pad = 0;
    if (b64.endsWith('==')) pad = 2;
    else if (b64.endsWith('=')) pad = 1;
    return out.subarray(0, out.length - pad);
}

/** hex 字符串（如 VAPID 密钥）→ 字节数组 */
function hexToBytes(hex: string): Uint8Array {
    const clean = hex.replace(/^0x/i, '');
    const bytes = new Uint8Array(clean.length / 2);
    for (let i = 0; i < bytes.length; i++) {
        bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
    }
    return bytes;
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
    const total = arrays.reduce((n, a) => n + a.length, 0);
    const out = new Uint8Array(total);
    let off = 0;
    for (const a of arrays) {
        out.set(a, off);
        off += a.length;
    }
    return out;
}

// ---------- HKDF-SHA256（RFC 5869，用 WebCrypto HMAC 组装） ----------

async function hmacSha256(keyBytes: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
    const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

/** HKDF-Extract：PRK = HMAC-SHA-256(key = IKM, msg = salt) */
async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
    return hmacSha256(ikm, salt);
}

/** HKDF-Expand：T(n) = HMAC(PRK, T(n-1) || info || n)，取前 length 字节 */
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
    const out = new Uint8Array(length);
    // 显式标注为 Uint8Array（默认 ArrayBufferLike），避免 TS 5.7+ 泛型 Uint8Array<ArrayBuffer>
    // 与函数声明返回类型不一致导致的赋值错误
    let t: Uint8Array = new Uint8Array(0);
    let offset = 0;
    for (let i = 1; offset < length; i++) {
        const buf = new Uint8Array(t.length + info.length + 1);
        buf.set(t, 0);
        buf.set(info, t.length);
        buf[t.length + info.length] = i;
        t = await hmacSha256(prk, buf);
        const toCopy = Math.min(t.length, length - offset);
        out.set(t.subarray(0, toCopy), offset);
        offset += toCopy;
    }
    return out;
}

// ---------- VAPID JWT（RFC 8292） ----------

/**
 * 生成 VAPID Authorization 头：`vapid t=<JWT>,k=<base64url(公钥)>`
 *
 * JWT header = {"typ":"JWT","alg":"ES256"}
 * JWT claims = {"aud": <endpoint 的 origin>, "exp": now+12h, "sub": "mailto:..."}
 *
 * 用 P-256 私钥做 ES256 签名。WebCrypto 的 subtle.sign('ECDSA') 输出是
 * IEEE P1363 格式（r||s 各 32 字节拼接 = 64 字节），正好是 JWT ES256 需要的格式，
 * 无需 DER → raw 转换。
 */
async function buildVapidAuthorization(endpoint: string, env: Bindings): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = { typ: 'JWT', alg: 'ES256' };
    const claims = {
        aud: new URL(endpoint).origin,
        exp: now + VAPID_TOKEN_TTL_SECONDS,
        sub: VAPID_SUBJECT,
    };
    const signingInput = `${base64UrlEncode(encoder.encode(JSON.stringify(header)))}.${base64UrlEncode(encoder.encode(JSON.stringify(claims)))}`;

    // VAPID_PRIVATE_KEY 是 hex 编码的 32 字节 P-256 私钥标量（raw 格式可直接导入）
    const privateKey = await crypto.subtle.importKey(
        'raw',
        hexToBytes(env.VAPID_PRIVATE_KEY),
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['sign']
    );
    const signature = new Uint8Array(await crypto.subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        privateKey,
        encoder.encode(signingInput)
    ));

    // 公钥：hex 的 65 字节非压缩点 → base64url
    const publicKeyB64 = base64UrlEncode(hexToBytes(env.VAPID_PUBLIC_KEY));
    return `vapid t=${signingInput}.${base64UrlEncode(signature)},k=${publicKeyB64}`;
}

// ---------- 载荷加密（RFC 8291 + RFC 8188 aes128gcm） ----------

/**
 * 按 RFC 8291 §3.3 派生加密密钥与 nonce：
 *
 *   PRK_key   = HKDF-Extract(salt = auth_secret,     ikm = ecdh_secret)      // 第一步混合 auth secret
 *   key_info  = "WebPush: info" || 0x00 || ua_public(65B) || as_public(65B)
 *   IKM       = HKDF-Expand(PRK_key, key_info, 32)
 *   salt      = 16 字节随机数
 *   PRK       = HKDF-Extract(salt, IKM)                                       // 第二步再用随机 salt
 *   CEK       = HKDF-Expand(PRK, "content-encoding: aes128gcm" || 0x00, 16)   // 128 位 AES 密钥
 *   NONCE     = HKDF-Expand(PRK, "nonce" || 0x00, 12)                         // 96 位 GCM IV
 *
 * 注意：浏览器端严格按 RFC 8291 实现，auth_secret 必须作为第一步的 salt 参与
 * HKDF（而不是用全零 salt），否则浏览器无法解密。
 */
async function deriveContentEncryptionKey(
    ecdhSecret: Uint8Array,
    authSecret: Uint8Array,
    uaPublic: Uint8Array,
    asPublic: Uint8Array
): Promise<{ cek: Uint8Array; nonce: Uint8Array; salt: Uint8Array }> {
    const keyInfo = concatBytes(
        encoder.encode('WebPush: info'),
        new Uint8Array([0]),
        uaPublic,   // 用户代理（浏览器）公钥，65 字节非压缩点
        asPublic    // 应用服务器（我们）临时公钥，65 字节非压缩点
    );

    // 第一阶段：用 auth_secret 作为 salt 提取 PRK_key
    const prkKey = await hkdfExtract(authSecret, ecdhSecret);
    // 展开出中间密钥材料 IKM
    const ikm = await hkdfExpand(prkKey, keyInfo, 32);

    // 第二阶段：随机 salt + IKM 再提取，派生 CEK 与 NONCE
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const prk = await hkdfExtract(salt, ikm);
    const cek = await hkdfExpand(prk, concatBytes(encoder.encode('content-encoding: aes128gcm'), new Uint8Array([0])), 16);
    const nonce = await hkdfExpand(prk, concatBytes(encoder.encode('nonce'), new Uint8Array([0])), 12);
    return { cek, nonce, salt };
}

/**
 * 组装 aes128gcm 加密载荷（RFC 8188 §2）：
 *
 *   header     = salt(16B) || rs(4B 大端 = 4096) || idlen(1B = 65) || as_public(65B)   → 86 字节
 *   plaintext  = payload || 0x02(最后一条记录分隔符) || 0x00...（填充到 ~400B 隐藏真实长度）
 *   ciphertext = AES-128-GCM(cek, nonce, plaintext)（GCM 自动附加 16B tag）
 *   body       = header || ciphertext
 */
async function encryptPayload(
    payloadJson: string,
    uaPublic: Uint8Array,
    authSecret: Uint8Array
): Promise<{ body: Uint8Array; } | null> {
    try {
        // 1. 生成临时 ECDH 密钥对（应用服务器侧，每次推送都是新的）
        // workers-types v4 的 generateKey 返回联合类型 CryptoKey | CryptoKeyPair，
        // 运行时始终返回密钥对，这里做窄化断言
        const ecdhKeyPair = (await crypto.subtle.generateKey(
            { name: 'ECDH', namedCurve: 'P-256' },
            true,
            ['deriveBits']
        )) as CryptoKeyPair;
        const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ecdhKeyPair.publicKey) as ArrayBuffer);

        // 2. 导入浏览器公钥，ECDH 派生共享密钥（32 字节）
        const uaPublicKey = await crypto.subtle.importKey(
            'raw',
            uaPublic,
            { name: 'ECDH', namedCurve: 'P-256' },
            false,
            []
        );
        // workers-types v4 的旧签名把 ECDH 对端公钥字段误标为 $public，
        // 但运行时严格按 WebCrypto 规范接受 { name: 'ECDH', public }，此处断言绕过类型瑕疵
        const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
            { name: 'ECDH', public: uaPublicKey } as SubtleCryptoDeriveKeyAlgorithm,
            ecdhKeyPair.privateKey,
            256
        ));

        // 3. RFC 8291 密钥调度
        const { cek, nonce, salt } = await deriveContentEncryptionKey(ecdhSecret, authSecret, uaPublic, asPublic);

        // 4. 填充：payload || 0x02 || 0x00...  目标总长 ~400B（隐私：避免按消息长度泄密）
        const payloadBytes = encoder.encode(payloadJson);
        const padLength = Math.max(0, TARGET_PADDED_LENGTH - payloadBytes.length - 1);
        const plaintext = concatBytes(payloadBytes, new Uint8Array([2]), new Uint8Array(padLength));

        // 5. AES-128-GCM 加密
        const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
        const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: nonce, tagLength: 128 },
            aesKey,
            plaintext
        ));

        // 6. aes128gcm 头（rs 4 字节大端；idlen 固定 65，因为 ECDH 公钥是非压缩点）
        const rs = new Uint8Array(4);
        new DataView(rs.buffer).setUint32(0, RECORD_SIZE, false);
        const header = concatBytes(salt, rs, new Uint8Array([65]), asPublic);

        return { body: concatBytes(header, ciphertext) };
    } catch (e) {
        console.error('webPush encrypt error:', e);
        return null;
    }
}

/**
 * 发送一条 Web Push 通知。
 * 返回 true = 推送服务已接受（HTTP 2xx）；任何失败都返回 false，绝不抛异常。
 *
 * 请求头：
 *   Content-Type: application/octet-stream
 *   TTL: 86400
 *   Content-Encoding: aes128gcm
 *   Authorization: vapid t=<JWT>,k=<公钥>
 *
 * 不发送 Crypto-Key 头：aes128gcm 模式下 ECDH 临时公钥已经在载荷 body 的 header 里
 * （idlen + 公钥字段），VAPID 的 k= 参数则携带认证公钥 —— Chrome/Firefox/FCM
 * 均接受这种 VAPID-only 组合。
 */
export async function sendPushNotification(
    env: Bindings,
    sub: { endpoint: string; p256dh_key: string; auth_key: string },
    payload: { title: string; body: string; url?: string }
): Promise<boolean> {
    // VAPID 密钥未配置时直接放弃（本地开发 / 未部署 secrets）
    if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) {
        console.warn('webPush: VAPID keys not configured, skipping push');
        return false;
    }
    try {
        // 1. 解析订阅里的 base64url 密钥
        const uaPublic = base64UrlDecode(sub.p256dh_key);
        const authSecret = base64UrlDecode(sub.auth_key);
        if (uaPublic.length !== 65 || authSecret.length !== 16) {
            console.error('webPush: invalid subscription keys', { uaLen: uaPublic.length, authLen: authSecret.length });
            return false;
        }

        // 2. 加密载荷（JSON 小消息）
        const payloadJson = JSON.stringify(payload);
        const encrypted = await encryptPayload(payloadJson, uaPublic, authSecret);
        if (!encrypted) return false;

        // 3. VAPID 认证头
        const authorization = await buildVapidAuthorization(sub.endpoint, env);

        // 4. POST 到推送服务端点，15s 超时
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
        try {
            const resp = await fetch(sub.endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/octet-stream',
                    'TTL': PUSH_TTL_HEADER,
                    'Content-Encoding': 'aes128gcm',
                    'Authorization': authorization,
                },
                body: encrypted.body,
                signal: controller.signal,
            });
            if (!resp.ok) {
                console.error('webPush: push service rejected', {
                    status: resp.status,
                    statusText: resp.statusText,
                    body: await resp.text().catch(() => ''),
                });
                return false;
            }
            return true;
        } finally {
            clearTimeout(timer);
        }
    } catch (e) {
        console.error('webPush send error:', e);
        return false;
    }
}

import { Bindings } from '../types';

const IMAGE_TYPES = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'image/svg+xml', 'image/bmp', 'image/x-icon',
]);

// 统一缓存头：浏览器缓存一天，CDN 层缓存一周
const IMAGE_CACHE_CONTROL = 'public, max-age=86400, s-maxage=604800';

function isPrivateIP(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0'
        || hostname === '[::1]' || hostname.endsWith('.local') || hostname.endsWith('.internal');
}

// 对 URL 做 SHA-256 摘要并转十六进制，得到 URL 安全、长度有界的 R2 缓存键
async function hashUrl(url: string): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(url));
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

export async function handleImageProxy(request: Request, env: Bindings): Promise<Response | null> {
    const url = new URL(request.url);
    const imgUrl = url.searchParams.get('url');
    if (!imgUrl) return null;

    // 内部 R2 对象（AI 插画持久化）：url 形如 r2://illustration/{newsId}.{ext}，直接读桶返回
    if (imgUrl.startsWith('r2://')) {
        if (!env.R2_IMAGES) {
            return new Response('R2 not configured', { status: 503 });
        }
        try {
            const key = imgUrl.substring(5);
            const obj = await env.R2_IMAGES.get(key);
            if (!obj) return new Response('Not found', { status: 404 });
            return new Response(obj.body, {
                headers: {
                    'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
                    'Cache-Control': IMAGE_CACHE_CONTROL,
                    'Access-Control-Allow-Origin': '*',
                },
            });
        } catch {
            return new Response('Image proxy error', { status: 502 });
        }
    }

    let parsed: URL;
    try {
        parsed = new URL(imgUrl);
    } catch {
        return new Response('Invalid URL', { status: 400 });
    }

    if (isPrivateIP(parsed.hostname)) {
        return new Response('Forbidden', { status: 403 });
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return new Response('Invalid protocol', { status: 400 });
    }

    // R2 缓存键：img/{sha256(url)}。R2 未配置或读写失败时静默降级为直连抓取
    const cacheKey = 'img/' + await hashUrl(imgUrl);

    // 命中缓存：直接从 R2 返回，不再回源
    if (env.R2_IMAGES) {
        try {
            const obj = await env.R2_IMAGES.get(cacheKey);
            if (obj) {
                return new Response(obj.body, {
                    headers: {
                        'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
                        'Cache-Control': IMAGE_CACHE_CONTROL,
                        'Access-Control-Allow-Origin': '*',
                    },
                });
            }
        } catch (e) {
            console.error('R2 缓存读取失败，降级直连抓取:', e);
        }
    }

    try {
        const imgRes = await fetch(imgUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CFNewsImage/1.0)', 'Referer': '' },
            signal: AbortSignal.timeout(10_000),
        });

        if (!imgRes.ok) {
            return new Response(imgRes.body, { status: imgRes.status });
        }

        const contentType = imgRes.headers.get('Content-Type') || '';
        if (!IMAGE_TYPES.has(contentType.split(';')[0].trim())) {
            return new Response('Not an image', { status: 400 });
        }

        // 缓存未命中：写入 R2（clone 流式上传，不消费返回给客户端的响应体）
        if (env.R2_IMAGES) {
            try {
                await env.R2_IMAGES.put(cacheKey, imgRes.clone().body, {
                    httpMetadata: { contentType },
                    customMetadata: { url: imgUrl },
                });
            } catch (e) {
                console.error('R2 缓存写入失败:', e);
            }
        }

        return new Response(imgRes.body, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': IMAGE_CACHE_CONTROL,
                'Access-Control-Allow-Origin': '*',
            },
        });
    } catch {
        return new Response('Image proxy error', { status: 502 });
    }
}

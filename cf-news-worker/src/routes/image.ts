import { Bindings } from '../types';

const IMAGE_TYPES = new Set([
    'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/avif',
    'image/svg+xml', 'image/bmp', 'image/x-icon',
]);

function isPrivateIP(hostname: string): boolean {
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0'
        || hostname === '[::1]' || hostname.endsWith('.local') || hostname.endsWith('.internal');
}

export async function handleImageProxy(request: Request, env: Bindings): Promise<Response | null> {
    const url = new URL(request.url);
    const imgUrl = url.searchParams.get('url');
    if (!imgUrl) return null;

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

        return new Response(imgRes.body, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Cache-Control': 'public, max-age=86400, s-maxage=604800',
                'Access-Control-Allow-Origin': '*',
            },
        });
    } catch {
        return new Response('Image proxy error', { status: 502 });
    }
}

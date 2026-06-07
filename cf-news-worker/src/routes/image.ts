import { Bindings } from '../types';

/**
 * Handle GET /api/image?url= — fetch external images through CF edge cache.
 * Returns a Response directly (not through Hono) to avoid rate limiting on image assets.
 */
export async function handleImageProxy(request: Request, env: Bindings): Promise<Response | null> {
    const url = new URL(request.url);
    const imgUrl = url.searchParams.get('url');
    if (!imgUrl) return null;

    try {
        const imgRes = await fetch(imgUrl, {
            headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CFNewsImage/1.0)', 'Referer': '' },
        });
        const imgBody = imgRes.ok ? imgRes.body : null;
        return new Response(imgBody, {
            status: imgRes.status,
            headers: {
                'Content-Type': imgRes.headers.get('Content-Type') || 'image/jpeg',
                'Cache-Control': 'public, max-age=86400, s-maxage=604800',
                'Access-Control-Allow-Origin': '*',
            },
        });
    } catch {
        return new Response('Image proxy error', { status: 502 });
    }
}

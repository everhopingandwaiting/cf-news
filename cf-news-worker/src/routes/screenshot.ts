import { Bindings } from '../types';

/**
 * Handle GET /api/screenshot?url= — page screenshot via Browser Rendering.
 * Returns a Response directly.
 */
export async function handleScreenshot(request: Request, env: Bindings): Promise<Response | null> {
    const url = new URL(request.url);
    const ssUrl = url.searchParams.get('url');
    if (!ssUrl) return null;

    try {
        const resp = await env.BROWSER.fetch('https://browser-rendering.cloudflare.com/chrome-screenshot', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: ssUrl, viewport: { width: 1280, height: 720 } }),
        });
        if (!resp.ok) return new Response(await resp.text() || 'Failed', { status: 502 });
        return new Response(resp.body, {
            headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=3600' },
        });
    } catch (e: any) {
        return new Response(e.message || 'Error', { status: 502 });
    }
}

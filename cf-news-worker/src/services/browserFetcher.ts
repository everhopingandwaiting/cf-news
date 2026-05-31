import { Bindings } from '../types';

/**
 * Fetch a URL using Cloudflare Browser Rendering (headless Chrome).
 * Use for sites that require JavaScript to render content.
 */
export async function fetchWithBrowser(env: Bindings, url: string): Promise<string | null> {
    try {
        const resp = await env.BROWSER.fetch('https://browser-rendering.cloudflare.com/chrome-content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url, waitUntil: 'networkidle', timeout: 15000 }),
        });
        if (!resp.ok) {
            console.error(`Browser rendering failed for ${url}: ${resp.status}`);
            return null;
        }
        const html = await resp.text();
        return html || null;
    } catch (e) {
        console.error(`Browser rendering error for ${url}:`, e);
        return null;
    }
}

/**
 * RSS sources that require JavaScript rendering.
 * Regular fetch() won't get content from these sites.
 */
export const JS_RENDER_SOURCES: Set<string> = new Set([
    'https://36kr.com/feed',
    'https://sspai.com/feed',
]);

/**
 * Check if a source needs browser rendering.
 */
export function needsBrowser(feedUrl: string): boolean {
    return JS_RENDER_SOURCES.has(feedUrl);
}

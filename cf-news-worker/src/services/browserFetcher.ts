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
 * 需要 JavaScript 渲染/过反爬挑战的站点（按主机名匹配，不按完整 URL）。
 *
 * 为什么按主机名：36kr 的 /feed 从 Cloudflare 出口直接 fetch 拿回的是 HTML
 * 挑战页（本机同样请求则是 application/rss+xml），必须走 Browser Rendering。
 * 原来按完整 URL 精确匹配，源地址一从 36kr.com 换成 www.36kr.com 就再也不会
 * 走浏览器渲染，且表现只是"每天 0 条"，没有任何报错。
 */
export const JS_RENDER_HOSTS = ['36kr.com', 'sspai.com'];

/** Check if a source needs browser rendering. */
export function needsBrowser(feedUrl: string): boolean {
    try {
        const host = new URL(feedUrl).hostname.toLowerCase();
        return JS_RENDER_HOSTS.some(h => host === h || host.endsWith(`.${h}`));
    } catch {
        return false;
    }
}

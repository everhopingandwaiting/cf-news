import { Bindings } from '../types';

const CRAWLER_RE = /facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|pinterest|baiduspider|googlebot|bingbot|yandexbot/i;

/**
 * Handle /share/:id — OG preview for social media crawlers.
 * For crawlers: returns HTML with OG meta tags.
 * For normal browsers: redirects to SPA with ?id= param.
 * Returns a Response directly.
 */
export async function handleShare(request: Request, env: Bindings): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/share/')) return null;

    const id = url.pathname.split('/')[2];
    if (!id || isNaN(Number(id))) return null;

    const ua = request.headers.get('User-Agent') || '';
    const isCrawler = CRAWLER_RE.test(ua);

    if (isCrawler) {
        try {
            const item = await env.DB.prepare(
                'SELECT title, description, image_url FROM news_items WHERE id = ?'
            ).bind(Number(id)).first<{ title: string; description: string; image_url: string }>();
            if (item) {
                // 优先用 AI 摘要，没有再用原文描述
                const summary = await env.DB.prepare('SELECT summary FROM news_summaries WHERE news_id = ?').bind(Number(id)).first<{ summary: string }>();
                const desc = (summary?.summary || item.description || '').replace(/<[^>]+>/g, '').substring(0, 200);
                // 图片走 CF 代理避免防盗链
                const imgUrl = item.image_url ? `/api/image?url=${encodeURIComponent(item.image_url)}` : '';
                const shareUrl = `https://${url.hostname}/share/${id}`;
                return new Response(`<!DOCTYPE html><html><head>
<meta charset="utf-8"><title>${item.title}</title>
<meta property="og:title" content="${item.title}">
<meta property="og:description" content="${desc}">
<meta property="og:url" content="${shareUrl}">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${item.title}">
<meta name="twitter:description" content="${desc}">
${imgUrl ? `<meta property="og:image" content="${imgUrl}"><meta name="twitter:image" content="${imgUrl}">` : ''}
<meta http-equiv="refresh" content="0;url=/?id=${id}">
</head><body>Redirecting...</body></html>`, {
                    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=3600' },
                });
            }
        } catch { /* fall through to SPA redirect */ }
    }

    // Non-crawler → serve SPA for client-side routing
    const spaRes = await fetch(new URL('/', request.url));
    return new Response(spaRes.body, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
}

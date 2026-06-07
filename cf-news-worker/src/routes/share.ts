import { Bindings } from '../types';
import { eq } from 'drizzle-orm';
import { getDb } from '../db';
import { newsItems, newsSummaries } from '../db/schema';

const CRAWLER_RE = /facebookexternalhit|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|pinterest|baiduspider|googlebot|bingbot|yandexbot/i;

export async function handleShare(request: Request, env: Bindings): Promise<Response | null> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/share/')) return null;

    const id = url.pathname.split('/')[2];
    if (!id || isNaN(Number(id))) return null;

    const ua = request.headers.get('User-Agent') || '';
    const isCrawler = CRAWLER_RE.test(ua);

    if (isCrawler) {
        try {
            const db = getDb(env);
            const item = await db.select({
                title: newsItems.title,
                description: newsItems.description,
                image_url: newsItems.image_url,
            })
                .from(newsItems)
                .where(eq(newsItems.id, Number(id)))
                .get();

            if (item) {
                const summary = await db.select({ summary: newsSummaries.summary })
                    .from(newsSummaries)
                    .where(eq(newsSummaries.news_id, Number(id)))
                    .get();

                const desc = (summary?.summary || item.description || '').replace(/<[^>]+>/g, '').substring(0, 200);
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

    const spaRes = await fetch(new URL('/', request.url));
    return new Response(spaRes.body, {
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' },
    });
}

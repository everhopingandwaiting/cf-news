import { Bindings } from '../types';
import { fetchWithBrowser } from './browserFetcher';

interface ScrapedItem {
    title: string;
    link: string;
    description?: string;
    pubDate?: string;
}

// 从首页 HTML 中提取 Next.js build ID
// 优先从 __NEXT_DATA__ script 中提取，这是 Next.js 实际使用的 buildId
function extractBuildId(html: string): string | null {
    const nextDataMatch = html.match(/"buildId"\s*:\s*"([a-f0-9]+)"/);
    if (nextDataMatch) return nextDataMatch[1];
    // fallback: 从 _app-{hash}.js 提取（旧方法，可能不准确）
    const m = html.match(/\/\/\_next\/static\/chunks\/pages\/_app-[a-f0-9]+\.js/);
    if (!m) return null;
    return m[0].match(/\_app-([a-f0-9]+)\./)?.[1] || null;
}

// 澎湃新闻 - 通过 Next.js 数据接口获取
// buildId 会随部署变化，需要从首页 HTML 中提取
export async function scrapeThePaper(env: Bindings): Promise<ScrapedItem[]> {
    // 先从首页获取 buildId
    const resp = await fetch('https://www.thepaper.cn/', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!resp.ok) return [];
    const html = await resp.text();

    const buildId = extractBuildId(html);
    if (!buildId) return [];

    // 请求 Next.js 数据 API
    const apiUrl = `https://www.thepaper.cn/_next/data/${buildId}/index.json`;
    const apiResp = await fetch(apiUrl);
    if (!apiResp.ok) return [];
    let json: any;
    try { json = await apiResp.json(); } catch { return []; }

    const items: ScrapedItem[] = [];
    const seen = new Set<string>();

    const extractArticles = (data: any) => {
        if (!data || typeof data !== 'object') return;
        for (const val of Object.values(data)) {
            if (Array.isArray(val)) {
                for (const item of val) {
                    if (item && item.contId && item.name) {
                        const link = item.link || `https://www.thepaper.cn/newsDetail_forward_${item.contId}`;
                        if (seen.has(link)) continue;
                        seen.add(link);

                        let pubDate: string | undefined;
                        if (item.pubTimeLong) pubDate = new Date(item.pubTimeLong).toISOString();

                        items.push({
                            title: item.name,
                            link,
                            description: item.abstract || item.name,
                            pubDate,
                        });
                    }
                }
            } else if (typeof val === 'object') {
                extractArticles(val);
            }
        }
    };

    extractArticles(json);

    return items.slice(0, 50);
}

export function getScraper(feedUrl: string, sourceUrl?: string): ((env: Bindings) => Promise<ScrapedItem[]>) | null {
    // Check both feed_url and source url
    const urls = [feedUrl, sourceUrl].filter(Boolean);
    for (const u of urls) {
        try {
            const hostname = new URL(u!).hostname;
            if (hostname.includes('thepaper.cn')) return scrapeThePaper;
        } catch {}
    }
    return null;
}

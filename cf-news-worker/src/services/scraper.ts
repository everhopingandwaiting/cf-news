import { Bindings } from '../types';
import { fetchWithBrowser } from './browserFetcher';

interface ScrapedItem {
    title: string;
    link: string;
    description?: string;
    pubDate?: string;
}

// 澎湃新闻 (thepaper.cn) 首页抓取
// 页面结构: 新闻列表在 div[class*="news"] 或 a[class*="link"] 中
export async function scrapeThePaper(env: Bindings): Promise<ScrapedItem[]> {
    const html = await fetchWithBrowser(env, 'https://m.thepaper.cn/');
    if (!html) return [];

    const items: ScrapedItem[] = [];
    const seen = new Set<string>();

    // 匹配新闻链接: <a[^>]*href="/(newsDetail|detail)_\d+"[^>]*>标题</a>
    const linkRegex = /<a[^>]*href="(\/(?:newsDetail|detail)_\d+)"[^>]*>([^<]+)<\/a>/gi;
    let match: RegExpExecArray | null;

    while ((match = linkRegex.exec(html)) !== null) {
        const link = match[1];
        const title = match[2].trim();
        const fullUrl = `https://m.thepaper.cn${link}`;

        if (title.length < 5 || seen.has(fullUrl)) continue;
        seen.add(fullUrl);

        // 提取发布时间（如果有）
        let pubDate: string | undefined;
        const timeMatch = html.substr(Math.max(0, match.index - 200), 400).match(/(\d+)分钟前/);
        if (timeMatch) {
            const minutesAgo = parseInt(timeMatch[1]);
            pubDate = new Date(Date.now() - minutesAgo * 60000).toISOString();
        }

        items.push({
            title,
            link: fullUrl,
            description: title,
            pubDate,
        });

        if (items.length >= 30) break;
    }

    return items;
}

// 根据域名选择对应的抓取函数
export function getScraper(url: string): ((env: Bindings) => Promise<ScrapedItem[]>) | null {
    const hostname = new URL(url).hostname;
    if (hostname.includes('thepaper.cn')) return scrapeThePaper;
    return null;
}

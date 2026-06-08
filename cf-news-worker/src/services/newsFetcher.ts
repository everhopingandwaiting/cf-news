import { Bindings, NewsSource } from '../types';
import { generateBatchSummariesForNews } from './summarizer';
import { indexNewsItem } from './tokenizer';
import { checkDuplicate, storeDedupHash } from './dedup';
import { uploadNewsItem } from './aiSearch';
import { fetchWithBrowser, needsBrowser } from './browserFetcher';
import { getScraper } from './scraper';
import { eq, sql } from 'drizzle-orm';
import { getDb } from '../db';
import { newsItems, newsSources } from '../db/schema';

interface RSSItem {
    title: string;
    link: string;
    description?: string;
    content?: string;
    pubDate?: string;
    image?: string;
}

const MAX_CONCURRENCY = 5;
const CLASSIFY_BATCH = 30;

function parseRSSFeed(xml: string): RSSItem[] {
    const items: RSSItem[] = [];
    const itemMatches = xml.match(/<item[^>]*>[\s\S]*?<\/item>/gi) || [];
    const entryMatches = xml.match(/<entry[^>]*>[\s\S]*?<\/entry>/gi) || [];
    const allItems = [...itemMatches, ...entryMatches];
    for (const item of allItems) {
        const title = extractTag(item, 'title');
        const link = extractLink(item);
        const description = extractTag(item, 'description') || extractTag(item, 'summary');
        const content = extractTag(item, 'content:encoded') || extractTag(item, 'content');
        const pubDate = extractTag(item, 'pubDate') || extractTag(item, 'published') || extractTag(item, 'updated');
        const image = extractImage(item);
        if (title && link) {
            items.push({
                title: cleanHTML(title),
                link,
                description: description ? cleanHTML(description).substring(0, 2000) : undefined,
                content: content ? cleanHTML(content).substring(0, 8000) : undefined,
                pubDate: pubDate || undefined,
                image: image || undefined,
            });
        }
    }
    return items;
}

function extractTag(xml: string, tag: string): string | undefined {
    const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
    const cdataMatch = xml.match(cdataRegex);
    if (cdataMatch) return cdataMatch[1].trim();
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : undefined;
}

function extractLink(xml: string): string | undefined {
    const linkTag = extractTag(xml, 'link');
    if (linkTag && !linkTag.includes('<')) return linkTag;
    const atomLinkMatch = xml.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    if (atomLinkMatch) return atomLinkMatch[1];
    const linkContentMatch = xml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    if (linkContentMatch) return linkContentMatch[1].trim();
    return undefined;
}

function extractImage(xml: string): string | undefined {
    const mediaMatch = xml.match(/<media:content[^>]*url=["']([^"']+)["'][^>]*\/?>/i);
    if (mediaMatch) return mediaMatch[1];
    const enclosureMatch = xml.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*\/?>/i);
    if (enclosureMatch) return enclosureMatch[1];
    const imgMatch = xml.match(/<img[^>]*src=["']([^"']+)["'][^>]*\/?>/i);
    if (imgMatch) return imgMatch[1];
    return undefined;
}

function cleanHTML(html: string): string {
    return html
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/\s+/g, ' ')
        .trim();
}

const classifyCache = new Map<string, string>();

async function batchClassifyCategories(
    env: Bindings,
    source: NewsSource,
    items: RSSItem[]
): Promise<string[]> {
    const categories = new Array<string>(items.length).fill(source.category);

    for (let start = 0; start < items.length; start += CLASSIFY_BATCH) {
        const end = Math.min(start + CLASSIFY_BATCH, items.length);
        const batch = items.slice(start, end);

        const uncached: number[] = [];
        for (let j = 0; j < batch.length; j++) {
            const text = `${batch[j].title} ${batch[j].description || ''}`;
            const cached = classifyCache.get(text);
            if (cached) {
                categories[start + j] = cached;
            } else {
                uncached.push(j);
            }
        }
        if (uncached.length === 0) continue;

        try {
            const titles = uncached.map(j => `${j + 1}. ${(batch[j].title || '').slice(0, 200)}`);
            const prompt = `Classify each news title into exactly one category: tech, ai, news, finance, entertainment, stocks, funds\n\n...`;
            const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
                prompt, max_tokens: uncached.length * 4, temperature: 0.1,
                gateway: { id: 'default', cacheTtl: 86400, skipCache: false },
            }) as { response: string };

            const text = (result.response || '').trim();
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (!jsonMatch) continue;
            const parsed = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(parsed)) continue;
            const valid = ['tech', 'ai', 'news', 'finance', 'entertainment', 'stocks', 'funds'];
            for (let k = 0; k < parsed.length && k < uncached.length; k++) {
                const cat = String(parsed[k]).toLowerCase();
                const matched = valid.find(v => cat.includes(v));
                const finalCat = matched || source.category;
                categories[start + uncached[k]] = finalCat;
                const cacheText = `${batch[uncached[k]].title} ${batch[uncached[k]].description || ''}`;
                classifyCache.set(cacheText, finalCat);
            }
        } catch (e) {
            console.error(`Batch classify failed for ${source.name} batch ${start}:`, e);
        }
    }
    return categories;
}

async function fetchFeed(env: Bindings, source: NewsSource): Promise<RSSItem[]> {
    try {
        if (source.source_type === 'scrape') {
            console.log(`Scraping ${source.name} via browser...`);
            const scraper = getScraper(source.feed_url);
            if (!scraper) { console.error(`No scraper available for ${source.name}`); return []; }
            const scraped = await scraper(env);
            return scraped.map(item => ({ title: item.title, link: item.link, description: item.description, pubDate: item.pubDate }));
        }

        let xml: string | null = null;
        if (needsBrowser(source.feed_url)) {
            console.log(`Using browser rendering for ${source.name}`);
            xml = await fetchWithBrowser(env, source.feed_url);
            if (xml) {
                const rssMatch = xml.match(/<rss[\s\S]*<\/rss>/i) || xml.match(/<feed[\s\S]*<\/feed>/i);
                if (rssMatch) xml = rssMatch[0];
            }
        }
        if (!xml) {
            const response = await fetch(source.feed_url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CFNewsWorker/1.0)' },
                signal: AbortSignal.timeout(15_000),
            });
            if (!response.ok) { console.error(`Failed to fetch ${source.name}: ${response.status}`); return []; }
            xml = await response.text();
        }
        return parseRSSFeed(xml);
    } catch (error) {
        console.error(`Error fetching ${source.name}:`, error);
        return [];
    }
}

async function saveNewsItems(
    env: Bindings, source: NewsSource, items: RSSItem[], categories: string[], skipSummary = false,
): Promise<number> {
    let savedCount = 0;
    const newItems: { id: number; title: string; description?: string; content?: string; url?: string }[] = [];
    const db = getDb(env);

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
            const isDup = await checkDuplicate(env, item.title, item.description);
            if (isDup) continue;

            const category = categories[i] || source.category;
            const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : null;

            const result = await db.run(sql`
                INSERT INTO news_items 
                (source_id, title, url, description, content, image_url, category, published_at, created_at)
                VALUES (${source.id}, ${item.title}, ${item.link}, ${item.description || null}, ${item.content || null}, ${item.image || null}, ${category}, ${publishedAt}, datetime('now', '+8 hours'))
                ON CONFLICT(url) DO UPDATE SET
                    title = excluded.title, description = excluded.description,
                    content = excluded.content, image_url = excluded.image_url,
                    category = excluded.category, published_at = excluded.published_at
            `);

            const row = await db.get<{ id: number }>(sql`SELECT id FROM news_items WHERE url = ${item.link}`);

            const isNew = result.meta.last_row_id > 0;
            if (isNew) savedCount++;

            if (row && row.id > 0) {
                newItems.push({ id: row.id, title: item.title, description: item.description, content: item.content, url: item.link });
                indexNewsItem(env, row.id, item.title, item.description).catch(e => console.error(`Index failed:`, e));
                storeDedupHash(env, row.id, item.title, item.description).catch(e => console.error(`Dedup failed:`, e));
                uploadNewsItem(env, { id: row.id, title: item.title, description: item.description, content: item.content, category, published_at: publishedAt || undefined }).catch(e => console.error(`AI Search upload failed:`, e));
            }
        } catch (error) {
            if (!String(error).includes('UNIQUE')) console.error(`Error saving item:`, error);
        }
    }

    if (newItems.length > 0 && !skipSummary) {
        console.log(`Generating AI summaries for ${newItems.length} new items...`);
        await generateBatchSummariesForNews(env, newItems.slice(0, 10));
    }
    return savedCount;
}

async function processSource(env: Bindings, source: NewsSource, skipSummary: boolean): Promise<number> {
    const t0 = Date.now();
    const db = getDb(env);
    try {
        console.log(`Fetching ${source.name}...`);
        const items = await fetchFeed(env, source);
        const fetchMs = Date.now() - t0;
        console.log(`[${fetchMs}ms] Got ${items.length} items from ${source.name}`);

        const categories = await batchClassifyCategories(env, source, items);
        const saved = await saveNewsItems(env, source, items, categories, skipSummary);
        console.log(`[${Date.now() - t0}ms] Saved ${saved} new items from ${source.name}`);

        await db.update(newsSources)
            .set({ last_fetched_at: sql`datetime("now", "+8 hours")`, last_fetched_count: saved })
            .where(eq(newsSources.id, source.id));
        return saved;
    } catch (e) {
        console.error(`Error processing ${source.name}:`, e);
        return 0;
    }
}

export async function fetchNews(env: Bindings, skipSummary = false): Promise<void> {
    console.log('Starting news fetch...');
    const db = getDb(env);
    const rows = await db.select({
        id: newsSources.id,
        name: newsSources.name,
        url: newsSources.url,
        feed_url: newsSources.feed_url,
        category: newsSources.category,
        language: newsSources.language,
        source_type: newsSources.source_type,
        enabled: newsSources.enabled,
        sort_order: newsSources.sort_order,
    })
        .from(newsSources)
        .where(sql`enabled = 1`)
        .orderBy(newsSources.sort_order)
        .all() as unknown as NewsSource[];

    console.log(`Found ${rows.length} enabled sources`);
    let totalSaved = 0;

    for (let i = 0; i < rows.length; i += MAX_CONCURRENCY) {
        const batch = rows.slice(i, i + MAX_CONCURRENCY);
        console.log(`Batch ${Math.floor(i / MAX_CONCURRENCY) + 1}: ${batch.map(s => s.name).join(', ')}`);
        const results = await Promise.allSettled(batch.map(source => processSource(env, source, skipSummary)));
        for (const r of results) {
            if (r.status === 'fulfilled') totalSaved += r.value;
        }
    }

    console.log(`News fetch complete. Total saved: ${totalSaved}`);
    if (totalSaved > 0) {
        await env.KV.put('news_cache_ver', String(Date.now())).catch(e => console.error('Failed to bump cache version:', e));
    }
}

export async function fetchSourceNews(env: Bindings, sourceId: number): Promise<number> {
    const db = getDb(env);
    const rows = await db.select({
        id: newsSources.id,
        name: newsSources.name,
        url: newsSources.url,
        feed_url: newsSources.feed_url,
        category: newsSources.category,
        language: newsSources.language,
        source_type: newsSources.source_type,
        enabled: newsSources.enabled,
        sort_order: newsSources.sort_order,
    })
        .from(newsSources)
        .where(eq(newsSources.id, sourceId))
        .all() as unknown as NewsSource[];

    const source = rows[0];
    if (!source) throw new Error('Source not found');

    const items = await fetchFeed(env, source);
    const categories = await batchClassifyCategories(env, source, items);
    return saveNewsItems(env, source, items, categories);
}

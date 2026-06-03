import { Bindings, NewsSource } from '../types';
import { generateSummaryForNews } from './summarizer';
import { indexNewsItem } from './tokenizer';
import { checkDuplicate, storeDedupHash } from './dedup';
import { uploadNewsItem } from './aiSearch';
import { fetchWithBrowser, needsBrowser } from './browserFetcher';
import { getScraper } from './scraper';

interface RSSItem {
    title: string;
    link: string;
    description?: string;
    content?: string;
    pubDate?: string;
    image?: string;
}

const MAX_CONCURRENCY = 5;   // 同时并发 fetch 的源数
const CLASSIFY_BATCH = 30;   // 每次 Workers AI 分类的标题数

// Parse RSS/Atom feed
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
    if (cdataMatch) {
        return cdataMatch[1].trim();
    }
    
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : undefined;
}

function extractLink(xml: string): string | undefined {
    const linkTag = extractTag(xml, 'link');
    if (linkTag && !linkTag.includes('<')) {
        return linkTag;
    }
    
    const atomLinkMatch = xml.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    if (atomLinkMatch) {
        return atomLinkMatch[1];
    }
    
    const linkContentMatch = xml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    if (linkContentMatch) {
        return linkContentMatch[1].trim();
    }
    
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

// ─── Batch AI classification ──────────────────────────────────────────────

const classifyCache = new Map<string, string>();

/** Batch-classify up to `CLASSIFY_BATCH` titles per Workers AI call.
 *  Returns a parallel array matching `items[]` order. */
async function batchClassifyCategories(
    env: Bindings,
    source: NewsSource,
    items: RSSItem[]
): Promise<string[]> {
    const categories = new Array<string>(items.length).fill(source.category);

    for (let start = 0; start < items.length; start += CLASSIFY_BATCH) {
        const end = Math.min(start + CLASSIFY_BATCH, items.length);
        const batch = items.slice(start, end);

        // Check cache for each item
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
            const titles = uncached.map(j =>
                `${j + 1}. ${(batch[j].title || '').slice(0, 200)}`
            );

            const prompt = `Classify each news title into exactly one category: tech, ai, news, finance, entertainment

Examples:
"英伟达发布Blackwell Ultra GPU" → tech
"OpenAI推出GPT-5推理模型" → ai
"美联储宣布加息25个基点" → finance
"好莱坞编剧罢工结束" → entertainment
"日本首相今日开始访华" → news
"Apple releases M4 chip" → tech
"New AI model beats benchmarks" → ai
"Stock market hits all-time high" → finance
"New movie breaks box office record" → entertainment
"Earthquake hits Japan" → news

Titles:
${titles.join('\n')}

Return a JSON array of categories matching each title, e.g.: ["tech","news","ai","finance","entertainment"]`;

            const result = await env.AI.run(
                '@cf/meta/llama-3.1-8b-instruct',
                {
                    prompt,
                    max_tokens: uncached.length * 4,
                    temperature: 0.1,
                    gateway: { id: 'default', cacheTtl: 86400, skipCache: false },
                },
            ) as { response: string };

            const text = (result.response || '').trim();
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (!jsonMatch) continue;

            const parsed = JSON.parse(jsonMatch[0]);
            if (!Array.isArray(parsed)) continue;

            const valid = ['tech', 'ai', 'news', 'finance', 'entertainment'];
            for (let k = 0; k < parsed.length && k < uncached.length; k++) {
                const cat = String(parsed[k]).toLowerCase();
                const matched = valid.find(v => cat.includes(v));
                const finalCat = matched || source.category;
                categories[start + uncached[k]] = finalCat;
                // Update cache — use the same cache key as before
                const cacheText = `${batch[uncached[k]].title} ${batch[uncached[k]].description || ''}`;
                classifyCache.set(cacheText, finalCat);
            }
        } catch (e) {
            console.error(
                `Batch classify failed for ${source.name} batch ${start}:`,
                e,
            );
            // Fallback: categories already default to source.category
        }
    }

    return categories;
}

// ─── Feed fetching ────────────────────────────────────────────────────────

// Fetch a single RSS feed
async function fetchFeed(env: Bindings, source: NewsSource): Promise<RSSItem[]> {
    try {
        if (source.source_type === 'scrape') {
            console.log(`Scraping ${source.name} via browser...`);
            const scraper = getScraper(source.feed_url);
            if (!scraper) {
                console.error(`No scraper available for ${source.name}`);
                return [];
            }
            const scraped = await scraper(env);
            return scraped.map(item => ({
                title: item.title,
                link: item.link,
                description: item.description,
                pubDate: item.pubDate,
            }));
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
                headers: {
                    'User-Agent': 'Mozilla/5.0 (compatible; CFNewsWorker/1.0)',
                },
            });
            if (!response.ok) {
                console.error(`Failed to fetch ${source.name}: ${response.status}`);
                return [];
            }
            xml = await response.text();
        }

        return parseRSSFeed(xml);
    } catch (error) {
        console.error(`Error fetching ${source.name}:`, error);
        return [];
    }
}

// ─── Save items to database ───────────────────────────────────────────────

// Save news items to database (categories pre-computed via batchClassifyCategories)
async function saveNewsItems(
    env: Bindings,
    source: NewsSource,
    items: RSSItem[],
    categories: string[],
    skipSummary = false,
): Promise<number> {
    let savedCount = 0;
    const newItems: { id: number; title: string; description?: string; content?: string; url?: string }[] = [];

    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        try {
            const isDup = await checkDuplicate(env, item.title, item.description);
            if (isDup) continue;

            const category = categories[i] || source.category;
            const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : null;

            await env.DB.prepare(`
                INSERT INTO news_items 
                (source_id, title, url, description, content, image_url, category, published_at, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', '+8 hours'))
                ON CONFLICT(url) DO UPDATE SET
                    title = excluded.title,
                    description = excluded.description,
                    content = excluded.content,
                    image_url = excluded.image_url,
                    category = excluded.category,
                    published_at = excluded.published_at
            `).bind(
                source.id,
                item.title,
                item.link,
                item.description || null,
                item.content || null,
                item.image || null,
                category,
                publishedAt,
            ).run();

            const row = await env.DB.prepare(
                'SELECT id FROM news_items WHERE url = ?',
            ).bind(item.link).first<{ id: number }>();

            if (row && row.id > 0) {
                savedCount++;
                newItems.push({
                    id: row.id,
                    title: item.title,
                    description: item.description,
                    content: item.content,
                    url: item.link,
                });
                // Background: index, dedup, AI Search upload
                indexNewsItem(env, row.id, item.title, item.description).catch(e =>
                    console.error(`Index failed for "${item.title}":`, e),
                );
                storeDedupHash(env, row.id, item.title, item.description).catch(e =>
                    console.error(`Dedup hash failed for "${item.title}":`, e),
                );
                uploadNewsItem(env, {
                    id: row.id,
                    title: item.title,
                    description: item.description,
                    content: item.content,
                    category,
                    published_at: publishedAt || undefined,
                }).catch(e =>
                    console.error(`AI Search upload failed for "${item.title}":`, e),
                );
            }
        } catch (error) {
            if (!String(error).includes('UNIQUE')) {
                console.error(`Error saving item "${item.title}":`, error);
            }
        }
    }

    // Generate AI summaries for new items (only for summary cron)
    if (newItems.length > 0 && !skipSummary) {
        console.log(`Generating AI summaries for ${newItems.length} new items...`);
        for (const item of newItems.slice(0, 10)) {
            try {
                await generateSummaryForNews(env, item.id, item);
            } catch (e) {
                console.error(`Summary failed for "${item.title}":`, e);
            }
        }
    }

    return savedCount;
}

// ─── Source-level processing ──────────────────────────────────────────────

/** Fetch, classify, save, and update last_fetched_at for one source. */
async function processSource(
    env: Bindings,
    source: NewsSource,
    skipSummary: boolean,
): Promise<number> {
    try {
        console.log(`Fetching ${source.name}...`);
        const items = await fetchFeed(env, source);
        console.log(`Got ${items.length} items from ${source.name}`);

        // Batch-classify all items BEFORE the save loop (removes per-item AI calls)
        const categories = await batchClassifyCategories(env, source, items);

        const saved = await saveNewsItems(env, source, items, categories, skipSummary);
        console.log(`Saved ${saved} new items from ${source.name}`);

        await env.DB.prepare(
            'UPDATE news_sources SET last_fetched_at = datetime("now", "+8 hours") WHERE id = ?',
        ).bind(source.id).run();

        return saved;
    } catch (e) {
        console.error(`Error processing ${source.name}:`, e);
        return 0;
    }
}

// ─── Main entry points ────────────────────────────────────────────────────

// Main fetch function (called by cron trigger)
export async function fetchNews(env: Bindings, skipSummary = false): Promise<void> {
    console.log('Starting news fetch...');

    const sources = await env.DB.prepare(
        'SELECT * FROM news_sources WHERE enabled = 1 ORDER BY sort_order',
    ).all<NewsSource>();

    console.log(`Found ${sources.results.length} enabled sources`);

    let totalSaved = 0;

    // Process sources in concurrent batches
    for (let i = 0; i < sources.results.length; i += MAX_CONCURRENCY) {
        const batch = sources.results.slice(i, i + MAX_CONCURRENCY);
        console.log(
            `Batch ${Math.floor(i / MAX_CONCURRENCY) + 1}: ${batch.map(s => s.name).join(', ')}`,
        );
        const results = await Promise.allSettled(
            batch.map(source => processSource(env, source, skipSummary)),
        );
        for (const r of results) {
            if (r.status === 'fulfilled') totalSaved += r.value;
        }
    }

    console.log(`News fetch complete. Total saved: ${totalSaved}`);
}

// Manual fetch for a specific source
export async function fetchSourceNews(env: Bindings, sourceId: number): Promise<number> {
    const source = await env.DB.prepare(
        'SELECT * FROM news_sources WHERE id = ?',
    ).bind(sourceId).first<NewsSource>();

    if (!source) {
        throw new Error('Source not found');
    }

    const items = await fetchFeed(env, source);
    const categories = await batchClassifyCategories(env, source, items);
    return saveNewsItems(env, source, items, categories);
}

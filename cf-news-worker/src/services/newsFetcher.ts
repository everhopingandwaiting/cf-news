import { Bindings, NewsSource } from '../types';
import { generateSummaryForNews } from './summarizer';
import { indexNewsItem } from './tokenizer';
import { checkDuplicate, storeDedupHash } from './dedup';
import { uploadNewsItem } from './aiSearch';
import { fetchWithBrowser, needsBrowser } from './browserFetcher';

interface RSSItem {
    title: string;
    link: string;
    description?: string;
    content?: string;
    pubDate?: string;
    image?: string;
}

// Parse RSS/Atom feed
function parseRSSFeed(xml: string): RSSItem[] {
    const items: RSSItem[] = [];
    
    // Simple XML parsing for RSS items
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
    // Handle CDATA
    const cdataRegex = new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i');
    const cdataMatch = xml.match(cdataRegex);
    if (cdataMatch) {
        return cdataMatch[1].trim();
    }
    
    // Handle regular content
    const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i');
    const match = xml.match(regex);
    return match ? match[1].trim() : undefined;
}

function extractLink(xml: string): string | undefined {
    // RSS 2.0 link
    const linkTag = extractTag(xml, 'link');
    if (linkTag && !linkTag.includes('<')) {
        return linkTag;
    }
    
    // Atom link
    const atomLinkMatch = xml.match(/<link[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
    if (atomLinkMatch) {
        return atomLinkMatch[1];
    }
    
    // Link with nested content
    const linkContentMatch = xml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
    if (linkContentMatch) {
        return linkContentMatch[1].trim();
    }
    
    return undefined;
}

function extractImage(xml: string): string | undefined {
    // Media content
    const mediaMatch = xml.match(/<media:content[^>]*url=["']([^"']+)["'][^>]*\/?>/i);
    if (mediaMatch) return mediaMatch[1];
    
    // Enclosure
    const enclosureMatch = xml.match(/<enclosure[^>]*url=["']([^"']+)["'][^>]*\/?>/i);
    if (enclosureMatch) return enclosureMatch[1];
    
    // Image in description
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

// Determine category based on source and content
function determineCategory(source: NewsSource, title: string, description?: string): string {
    const text = `${title} ${description || ''}`.toLowerCase();
    
    // Tech keywords
    if (text.match(/ai|人工智能|机器学习|编程|开发|软件|硬件|芯片|crypto|区块链|web3|startup|融资/)) {
        return 'tech';
    }
    
    // Finance keywords
    if (text.match(/股票|基金|金融|投资|经济|银行|利率|通胀|market|stock|finance/)) {
        return 'finance';
    }
    
    // Entertainment keywords
    if (text.match(/电影|音乐|游戏|娱乐|明星|综艺|movie|music|game|entertainment/)) {
        return 'entertainment';
    }
    
    // Default to source category
    return source.category;
}

// Fetch a single RSS feed
async function fetchFeed(env: Bindings, source: NewsSource): Promise<RSSItem[]> {
    try {
        let xml: string | null = null;

        // Use Browser Rendering for JS-heavy sources
        if (needsBrowser(source.feed_url)) {
            console.log(`Using browser rendering for ${source.name}`);
            xml = await fetchWithBrowser(env, source.feed_url);
            if (xml) {
                // Extract RSS/XML from rendered HTML
                const rssMatch = xml.match(/<rss[\s\S]*<\/rss>/i) || xml.match(/<feed[\s\S]*<\/feed>/i);
                if (rssMatch) xml = rssMatch[0];
            }
        }

        // Fallback to regular fetch
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

// Save news items to database
async function saveNewsItems(env: Bindings, source: NewsSource, items: RSSItem[], skipSummary = false): Promise<number> {
    let savedCount = 0;
    const newItems: { id: number; title: string; description?: string; content?: string; url?: string }[] = [];

    for (const item of items) {
        try {
            const isDup = await checkDuplicate(env, item.title, item.description);
            if (isDup) continue;

            const category = determineCategory(source, item.title, item.description);
            const publishedAt = item.pubDate ? new Date(item.pubDate).toISOString() : null;

            const result = await env.DB.prepare(`
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
                publishedAt
            ).run();

            // Get the correct ID (new insert or existing)
            const row = await env.DB.prepare(
                'SELECT id FROM news_items WHERE url = ?'
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
                // Build KV search index for this item
                indexNewsItem(env, row.id, item.title, item.description).catch(e =>
                    console.error(`Index failed for "${item.title}":`, e)
                );
                storeDedupHash(env, row.id, item.title, item.description).catch(e =>
                    console.error(`Dedup hash failed for "${item.title}":`, e)
                );
                // Upload to AI Search
                uploadNewsItem(env, {
                    id: row.id,
                    title: item.title,
                    description: item.description,
                    content: item.content,
                    category,
                    published_at: publishedAt || undefined,
                }).catch(e =>
                    console.error(`AI Search upload failed for "${item.title}":`, e)
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

// Main fetch function (called by cron trigger)
export async function fetchNews(env: Bindings, skipSummary = false): Promise<void> {
    console.log('Starting news fetch...');
    
    // Get all enabled sources
    const sources = await env.DB.prepare(
        'SELECT * FROM news_sources WHERE enabled = 1 ORDER BY sort_order'
    ).all<NewsSource>();
    
    console.log(`Found ${sources.results.length} enabled sources`);
    
    let totalSaved = 0;

    for (const source of sources.results) {
        try {
            console.log(`Fetching ${source.name}...`);
            const items = await fetchFeed(env, source);
            console.log(`Got ${items.length} items from ${source.name}`);

            const saved = await saveNewsItems(env, source, items, skipSummary);
            console.log(`Saved ${saved} new items from ${source.name}`);

            await env.DB.prepare(
                'UPDATE news_sources SET last_fetched_at = datetime("now", "+8 hours") WHERE id = ?'
            ).bind(source.id).run();

            totalSaved += saved;
        } catch (e) {
            console.error(`Error fetching ${source.name}:`, e);
        }
    }
    
    console.log(`News fetch complete. Total saved: ${totalSaved}`);
}

// Manual fetch for a specific source
export async function fetchSourceNews(env: Bindings, sourceId: number): Promise<number> {
    const source = await env.DB.prepare(
        'SELECT * FROM news_sources WHERE id = ?'
    ).bind(sourceId).first<NewsSource>();
    
    if (!source) {
        throw new Error('Source not found');
    }
    
    const items = await fetchFeed(env, source);
    return saveNewsItems(env, source, items);
}
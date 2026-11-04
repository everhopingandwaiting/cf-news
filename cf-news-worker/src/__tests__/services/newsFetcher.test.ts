import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fetchSourceNews, normalizePublishedAt, readFetchStats } from '../../services/newsFetcher';
import { getScraper } from '../../services/scraper';
import { needsBrowser } from '../../services/browserFetcher';
import { buildTestApp, MOCK_ENV } from '../helpers';
import { resetDb } from '../../db';

const source = (feed_url: string, language: string, url = feed_url) => ({ feed_url, url, language });

const rss = (items: string) =>
    `<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>t</title>${items}</channel></rss>`;

const rssResponse = (items: string) => new Response(rss(items), {
    status: 200,
    headers: { 'Content-Type': 'application/rss+xml' },
});

describe('newsFetcher date normalization', () => {
    it('treats confirmed Chinese GMT-labeled feeds as China-local wall-clock time', () => {
        expect(normalizePublishedAt(
            'Wed, 24 Jun 2026 17:39:00 GMT',
            source('https://www.infoq.cn/feed', 'zh'),
        )).toBe('2026-06-24T09:39:00.000Z');

        expect(normalizePublishedAt(
            'Wed, 24 Jun 2026 12:21:21 GMT',
            source('https://www.ithome.com/rss/', 'zh'),
        )).toBe('2026-06-24T04:21:21.000Z');
    });

    it('keeps real GMT for unlisted Chinese-language feeds', () => {
        expect(normalizePublishedAt(
            'Wed, 24 Jun 2026 17:39:00 GMT',
            source('https://cn.nytimes.com/rss/', 'zh'),
        )).toBe('2026-06-24T17:39:00.000Z');
    });

    it('treats timezone-less Chinese feed dates as China-local time', () => {
        expect(normalizePublishedAt(
            '2026-06-24 18:35:25',
            source('https://example.cn/feed', 'zh'),
        )).toBe('2026-06-24T10:35:25.000Z');
    });

    it('does not assume CST for timezone-less English feed dates', () => {
        expect(normalizePublishedAt(
            '2026-06-24 18:35:25',
            source('https://example.com/feed', 'en'),
        )).toBe('2026-06-24T18:35:25.000Z');
    });

    it('returns null for missing or invalid dates', () => {
        expect(normalizePublishedAt(undefined, source('https://example.com/feed', 'en'))).toBeNull();
        expect(normalizePublishedAt('not a date', source('https://example.com/feed', 'en'))).toBeNull();
    });
});

describe('feed source routing', () => {
    it('routes 36kr / sspai to browser rendering by host (www included)', () => {
        expect(needsBrowser('https://36kr.com/feed')).toBe(true);
        expect(needsBrowser('https://www.36kr.com/feed')).toBe(true);
        expect(needsBrowser('https://sspai.com/feed')).toBe(true);
        expect(needsBrowser('https://www.ithome.com/rss/')).toBe(false);
        expect(needsBrowser('not a url')).toBe(false);
    });

    it('does not let the site scraper hijack a third-party RSS bridge', () => {
        expect(typeof getScraper('https://www.thepaper.cn/rss_newsDetail_wap.jsp')).toBe('function');
        // 澎湃实际订阅的是 decemberpei 镜像；站点主页仍是 thepaper.cn，但 feed 不在该域
        expect(getScraper('https://decemberpei.cyou/rssbox/wechat-pengpaixinwen.xml')).toBeNull();
    });
});

describe('newsFetcher ingestion telemetry', () => {
    let db: ReturnType<typeof buildTestApp>['db'];
    let archive: ReturnType<typeof buildTestApp>['archive'];
    let env: any;

    beforeAll(() => {
        resetDb();
        vi.stubGlobal('caches', { default: { match: async () => null, put: async () => {}, delete: async () => {} } });
        const built = buildTestApp();
        db = built.db;
        archive = built.archive;
        env = { ...MOCK_ENV, DB: db, DB_ARCHIVE: archive };
    });

    it('handles redirect + non-feed content-type by parsing feed markers (OpenAI Blog case)', async () => {
        await db.seed('news_sources', [
            { id: 999, name: 'OpenAI Blog', feed_url: 'https://openai.com/blog/rss.xml', category: 'tech', language: 'en' },
        ]);
        vi.stubGlobal('fetch', async (url: string) => {
            // 模拟 307 重定向 → 最终页面内容为 text/plain 但包含 RSS 标记（CF 改写 content-type 场景）
            if (String(url).includes('openai.com/blog/rss.xml')) {
                const xml = '<?xml version="1.0"?><rss><channel><item><title>AI Update</title><link>https://openai.com/news/1</link></item></channel></rss>';
                return new Response(xml, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
            }
            return new Response('<rss/>', { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
        });
        const saved = await fetchSourceNews(env, 999);
        expect(saved).toBeGreaterThan(0);
    });

    it('saves items, falls back to fetch time when the feed has no pubDate, and records stats', async () => {
        await db.seed('news_sources', [
            { id: 101, name: 'DateSrc', feed_url: 'https://date.test/rss', category: 'news', language: 'en' },
        ]);
        vi.stubGlobal('fetch', async () => rssResponse(
            '<item><title>Dated</title><link>https://date.test/a</link><description>da</description><pubDate>Fri, 30 Oct 2026 08:00:00 GMT</pubDate></item>'
            + '<item><title>Undated</title><link>https://date.test/b</link><description>db</description></item>',
        ));

        const before = Date.now();
        const saved = await fetchSourceNews(env, 101);
        expect(saved).toBe(2);

        const rows = (await db.prepare(
            'SELECT url, published_at FROM news_items WHERE source_id = 101 ORDER BY url',
        ).all()).results as { url: string; published_at: string | null }[];
        expect(rows).toHaveLength(2);

        const dated = rows.find(r => r.url === 'https://date.test/a');
        expect(dated?.published_at).toBe('2026-10-30T08:00:00.000Z');

        // 无 pubDate 的条目不能留 NULL（否则日报/时间线/趋势全部看不到）
        const undated = rows.find(r => r.url === 'https://date.test/b');
        expect(undated?.published_at).toBeTruthy();
        const fallbackMs = new Date(undated!.published_at!).getTime();
        expect(fallbackMs).toBeGreaterThanOrEqual(before - 1000);
        expect(fallbackMs).toBeLessThanOrEqual(Date.now() + 60_000);

        const stats = await readFetchStats(env, 101);
        expect(stats).toMatchObject({ items: 2, saved: 2, skippedDedup: 0, skippedArchived: 0, failed: 0, error: null });
        expect(typeof stats?.at).toBe('string');

        const src = await db.prepare('SELECT last_fetched_count FROM news_sources WHERE id = 101').first() as { last_fetched_count: number };
        expect(src.last_fetched_count).toBe(2);
    });

    it('counts archived-URL skips instead of silently saving nothing', async () => {
        await db.seed('news_sources', [
            { id: 102, name: 'ArchSrc', feed_url: 'https://arch.test/rss', category: 'news', language: 'en' },
        ]);
        await archive.seed('news_items', [
            { id: 9001, source_id: 102, title: 'Old copy', url: 'https://arch.test/dup', is_deleted: 0 },
        ]);
        vi.stubGlobal('fetch', async () => rssResponse(
            '<item><title>Already archived</title><link>https://arch.test/dup</link><description>d</description></item>',
        ));

        const saved = await fetchSourceNews(env, 102);
        expect(saved).toBe(0);

        const stats = await readFetchStats(env, 102);
        expect(stats).toMatchObject({ items: 1, saved: 0, skippedArchived: 1, skippedDedup: 0, failed: 0 });
    });

    it('records items=0 when the feed is not parseable (HTML instead of RSS)', async () => {
        await db.seed('news_sources', [
            { id: 103, name: 'HtmlSrc', feed_url: 'https://html.test/feed', category: 'tech', language: 'en' },
        ]);
        vi.stubGlobal('fetch', async () => new Response('<!DOCTYPE html><html><body>not a feed</body></html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
        }));

        const saved = await fetchSourceNews(env, 103);
        expect(saved).toBe(0);

        const stats = await readFetchStats(env, 103);
        expect(stats).toMatchObject({ items: 0, saved: 0, failed: 0 });
    });

    it('ingests via the RSS bridge even when the site url matches a scraper', async () => {
        await db.seed('news_sources', [{
            id: 105, name: '澎湃新闻', url: 'https://www.thepaper.cn',
            feed_url: 'https://bridge.test/pengpai.xml', category: 'news', language: 'zh',
        }]);
        vi.stubGlobal('fetch', async () => rssResponse(
            '<item><title>桥梁条目</title><link>https://mp.weixin.qq.com/s/bridge-1</link><description>d</description></item>',
        ));

        const saved = await fetchSourceNews(env, 105);
        expect(saved).toBe(1);
        const stats = await readFetchStats(env, 105);
        expect(stats).toMatchObject({ items: 1, saved: 1 });
    });

    it('does not bump published_at when an existing item is re-fetched', async () => {
        await db.seed('news_sources', [
            { id: 104, name: 'RefetchSrc', feed_url: 'https://refetch.test/rss', category: 'news', language: 'en' },
        ]);
        await db.seed('news_items', [
            {
                id: 9101, source_id: 104, title: 'Refetched', url: 'https://refetch.test/a',
                description: 'd', published_at: '2026-01-02T03:04:05.000Z', is_deleted: 0,
            },
        ]);
        vi.stubGlobal('fetch', async () => rssResponse(
            '<item><title>Refetched</title><link>https://refetch.test/a</link><description>d</description><pubDate>Fri, 30 Oct 2026 08:00:00 GMT</pubDate></item>',
        ));

        await fetchSourceNews(env, 104);

        const row = await db.prepare('SELECT published_at FROM news_items WHERE url = ?').bind('https://refetch.test/a').first() as { published_at: string };
        expect(row.published_at).toBe('2026-01-02T03:04:05.000Z');
    });
});

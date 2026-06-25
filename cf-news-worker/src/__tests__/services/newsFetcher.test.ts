import { describe, expect, it } from 'vitest';
import { normalizePublishedAt } from '../../services/newsFetcher';

const source = (feed_url: string, language: string, url = feed_url) => ({ feed_url, url, language });

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

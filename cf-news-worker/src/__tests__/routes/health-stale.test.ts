import { describe, it, expect, beforeEach } from 'vitest';
import { buildTestApp, request, MOCK_ENV } from '../helpers';
import {
    FETCH_CRON,
    FETCH_INTERVAL_MINUTES,
    FETCH_HEARTBEAT_STALE_MINUTES,
    NEWS_STALE_MINUTES,
} from '../../cronSchedule';

/**
 * 抓取频率下调后，"距上次心跳刚好一个周期" 成为常态（2 小时抓取 → 心跳年龄
 * 最长 120 分钟）。旧阈值为 120 分钟，等号即误报。这里锁定正常区间不误报、
 * 真断摆仍能报警两个方向。
 */
describe('健康检查阈值 × 抓取间隔', () => {
    let app: ReturnType<typeof buildTestApp>['app'];
    let db: ReturnType<typeof buildTestApp>['db'];

    const agoMin = (m: number) => new Date(Date.now() - m * 60000).toISOString();

    beforeEach(() => {
        const built = buildTestApp();
        app = built.app;
        db = built.db;
    });

    async function seed(ageMin: number) {
        await db.seed('news_items', [
            { id: 2, source_id: 1, title: 'Fresh', url: 'https://h/2', category: 'tech', is_deleted: 0, created_at: agoMin(ageMin) },
        ]);
        await db.seed('cron_heartbeat', [
            { cron_name: FETCH_CRON, last_fired_at: agoMin(ageMin) },
        ]);
    }

    it('心跳年龄接近一个完整抓取周期时不误报 stale', async () => {
        // 抓取周期 - 1 分钟：正常最坏情况（刚要触发下一次抓取）
        await seed(FETCH_INTERVAL_MINUTES - 1);
        const { status, body } = await request(app, db, '/api/health/feed');
        expect(status).toBe(200);
        expect(body.ok).toBe(true);
        expect(body.problems).toEqual([]);
    });

    it('超过阈值后仍能报出 fetch cron 心跳过期', async () => {
        await seed(FETCH_HEARTBEAT_STALE_MINUTES + 10);
        const { status, body } = await request(app, db, '/api/health/feed');
        expect(status).toBe(200);
        expect(body.ok).toBe(false);
        expect(body.problems.join()).toMatch(/fetch cron heartbeat stale/);
    });

    it('超过阈值后仍能报出 news_items 陈旧', async () => {
        await seed(NEWS_STALE_MINUTES + 10);
        const { status, body } = await request(app, db, '/api/health/feed');
        expect(status).toBe(200);
        expect(body.ok).toBe(false);
        expect(body.problems.join()).toMatch(/news_items stale/);
    });

    it('D1 完全不可用时返回 503 而非假健康', async () => {
        const originalPrepare = db.prepare.bind(db);
        db.prepare = () => { throw new Error('D1 unavailable (simulated)'); };
        try {
            const { status } = await request(app, db, '/api/health/feed');
            expect(status).toBe(503);
        } finally {
            db.prepare = originalPrepare;
        }
    });

    it('读取 KV 心跳键名与抓取 cron 一致', async () => {
        await db.seed('news_items', [
            { id: 9, source_id: 1, title: 'KV hb', url: 'https://h/9', category: 'tech', is_deleted: 0, created_at: new Date().toISOString() },
        ]);
        const seen: string[] = [];
        const originalGet = MOCK_ENV.KV.get;
        MOCK_ENV.KV.get = async (key: string) => {
            seen.push(key);
            return key === `cron_hb:${FETCH_CRON}` ? new Date().toISOString() : null;
        };
        try {
            const { body } = await request(app, db, '/api/health/feed');
            expect(body.ok).toBe(true);
            expect(seen).toContain(`cron_hb:${FETCH_CRON}`);
        } finally {
            MOCK_ENV.KV.get = originalGet;
        }
    });
});

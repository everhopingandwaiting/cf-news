import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
    FETCH_CRON,
    FETCH_INTERVAL_MINUTES,
    FETCH_HEARTBEAT_STALE_MINUTES,
    NEWS_STALE_MINUTES,
} from '../../cronSchedule';

/**
 * crons 数组在 wrangler.toml，代码从 cronSchedule.ts 取值，两者是跨文件的
 * 同步关系（TOML 无法 import TS）。本文件是这道同步的唯一守卫：
 * 调整抓取频率时若只改了一边，这里立刻失败。
 */
function readCrons(file: string): string[] {
    const path = join(__dirname, '..', '..', '..', file);
    const m = readFileSync(path, 'utf-8').match(/^crons\s*=\s*\[(.*?)\]/m);
    expect(m, `${file} 缺少 crons 数组`).toBeTruthy();
    return m![1].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
}

/**
 * 解析 cron 表达式的最小间隔（分钟）。只处理本项目实际用到的形式：
 * 每 N 分钟、每小时第 M 分、每分钟、每 N 小时第 M 分、每天第 H 时第 M 分。
 * 返回 null 表示该形式无法静态推导（调用方自行决定是否跳过断言）。
 */
function cronIntervalMinutes(expr: string): number | null {
    const [min, hour] = expr.trim().split(/\s+/);
    if (!hour) return null;
    const step = (field: string) => (/^\*\/\d+$/.test(field) ? parseInt(field.split('/')[1], 10) : null);
    const isAny = (field: string) => field === '*';

    // 每 N 分钟：`*\/N * * * *`
    const minStep = step(min);
    if (minStep !== null) return minStep;

    // 每小时（或每 N 小时）的第 M 分：`M * * * *` / `M *\/N * * *`
    if (isAny(hour)) return 60;
    const hourStep = step(hour);
    if (hourStep !== null) return 60 * hourStep;

    // 每天定点：`M H * * *`
    if (/^\d+$/.test(min) && /^\d+$/.test(hour)) return 1440;

    return null;
}

describe('cron 调度一致性', () => {
    for (const file of ['wrangler.toml.example', 'wrangler.toml']) {
        describe(file, () => {
            const crons = readCrons(file);

            it('抓取 cron 与 cronSchedule.ts 一致', () => {
                expect(crons).toContain(FETCH_CRON);
            });

            it('保持 Workers Free 的 5 个 cron 触发器上限', () => {
                expect(crons).toHaveLength(5);
            });

            it('cron 表达式无重复（重复会被 Cloudflare 拒绝部署）', () => {
                expect(new Set(crons).size).toBe(crons.length);
            });

            it('FETCH_INTERVAL_MINUTES 与 cron 表达式推导值一致', () => {
                const derived = cronIntervalMinutes(FETCH_CRON);
                expect(derived, `无法解析抓取 cron: ${FETCH_CRON}`).not.toBeNull();
                expect(FETCH_INTERVAL_MINUTES).toBe(derived);
            });

            it('所有 cron 表达式均可静态解析出间隔', () => {
                for (const expr of crons) {
                    expect(cronIntervalMinutes(expr), `无法解析 cron: ${expr}`).not.toBeNull();
                }
            });

            // 阈值 <= 间隔时，每次抓取触发前健康检查都会误报 stale。
            // 这是 2026-10 抓取频率下调时的真实回归风险，钉死。
            it('心跳阈值显著大于抓取间隔', () => {
                expect(FETCH_HEARTBEAT_STALE_MINUTES).toBeGreaterThan(FETCH_INTERVAL_MINUTES);
            });

            it('新闻新鲜度阈值显著大于抓取间隔', () => {
                expect(NEWS_STALE_MINUTES).toBeGreaterThan(FETCH_INTERVAL_MINUTES);
            });
        });
    }

    it('心跳阈值留有容忍余量（超过一个完整周期）', () => {
        expect(FETCH_HEARTBEAT_STALE_MINUTES).toBeGreaterThanOrEqual(FETCH_INTERVAL_MINUTES * 5 / 3);
    });

    it('保留每日 retention/驱逐与模型同步的触发点', () => {
        const crons = readCrons('wrangler.toml.example');
        expect(crons).toContain('0 8 * * *');
        expect(crons).toContain('0 */6 * * *');
        expect(crons).toContain('*/5 * * * *');
        expect(crons).toContain('*/15 * * * *');
    });
});

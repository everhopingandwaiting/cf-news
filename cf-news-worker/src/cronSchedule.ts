/**
 * 抓取 cron 的单一事实来源。
 *
 * 背景：`crons` 数组写在 wrangler.toml 里，而 index.ts 的 scheduled 分发与
 * /api/health/feed 的心跳读取都靠字符串匹配同一个 cron 表达式。历史上这两处
 * 是各自硬编码的——调整频率时只要漏改一处，健康检查就会永远报
 * "fetch cron heartbeat stale"（阈值 < 抓取间隔时必然假报警）。
 *
 * 现在统一从这里取值，并由 `__tests__/routes/cron-schedule.test.ts` 断言
 * 与 wrangler.toml(.example) 的 crons 数组保持一致，改频率只改两处
 * （本文件 + wrangler 配置），测试负责兜底。
 */

/** 抓取 cron 表达式（UTC）。必须与 wrangler.toml 的 crons 数组首项一致。 */
export const FETCH_CRON = '0 */2 * * *';

/** 抓取 cron 间隔（分钟），由 FETCH_CRON 推导。 */
export const FETCH_INTERVAL_MINUTES = 120;

/**
 * 心跳过期阈值（分钟）：必须显著大于抓取间隔，否则每次抓取触发前
 * 健康检查都会误报 stale。留 80 分钟余量（约 2/3 个周期）容忍偶发延迟。
 */
export const FETCH_HEARTBEAT_STALE_MINUTES = 200;

/**
 * 新闻新鲜度过期阈值（分钟）：必须显著大于抓取间隔，否则正常间隔
 * 就会报 "news_items stale"。留 240 分钟余量。
 */
export const NEWS_STALE_MINUTES = 360;

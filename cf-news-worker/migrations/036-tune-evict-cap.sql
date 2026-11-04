-- Migration 036: 驱逐日帽 10000 → 2500（修正 035 的写入量误算）
-- Applied: 2026-11-05 00:10 UTC（配额重置后由调度任务执行；文件先于重置提交）
--
-- 为什么 035 的 10000 太大：D1 免费档每日 limits 是**账户级** 100,000 rows_written
-- （跨本账号全部 D1 库共享，2026-09-01 起强制执行，超限至次日 00:00 UTC 重置前
-- 一切 D1 写入失败——2026-11-04 已实锤：当日两库合计 228k，07:00 后全站写冻结，
-- 抓取/摘要/驱逐静默失败，PUT /admin/sources 500）。
--
-- 实测每迁 1 行的实际账：
--   copyRows 5 张子表 + news_items + news_fts 归档侧 INSERT（含索引行），
--   + 主库 DELETE（含 FTS 与二级索引行）= **17~23 次 rows_written/行**（035 按 7 估的，
--   低估 3 倍）。今天迁 10000 行烧掉 ~170k 账户写。
--
-- 基线（非驱逐）账户级日写量：近 4 天 55k~101k/日（含 4000 行驱逐的历史日），
-- 非驱逐日 ≈55-70k。预留 <90k 安全线：
--   2500 行 × ~18 写 ≈ 45k + 基线 ≈ 85-90k——贴近但不越 100k。
-- 4000 行历史上限时也只勉强贴线（2026-11-01 100,661 已是运气）。
--
-- 影响：达成 80%（400MB）从 2-3 天放宽到约 5-7 天（2500 行/天 × ~12.5MB/5000 行
-- ≈ 6.2MB/日，425.6MB → 一周内 <400MB）。热窗口 45 天不变。
--
-- 若需再加速：先解决 archive 库非驱逐日的 ~20-48k/日 mystery 写基线（ GraphQL
-- d1AnalyticsAdaptiveGroups 按日按库追踪），再按余量上调；或升级 Workers Paid 解除配额。

INSERT OR REPLACE INTO app_config (key, value) VALUES ('archive.evict_max_rows', '2500');

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '36');

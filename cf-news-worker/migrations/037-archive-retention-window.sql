-- Migration 037: 归档库滚动保留 120 天 + 驱逐日帽 2500→2000
-- Applied: 2026-11-10
--
-- 背景：归档库只进不出（每日 +2500 行、~9MB），2026-11-10 已 350.8MB（70.2%），
-- 按 9MB/日约 2 周后撞 500MB 硬顶；届时驱逐侧 INSERT 失败 → 主库重新膨胀。
--
-- 方案："进一出一"滚动窗口——每日维护链在驱逐迁入 N 行后，顺路从归档库删掉
-- 超 archive.retention_days 的等量最老行（含子表/FTS）。归档库净增长归零，
-- 无需一次性大扫除（4.7 万行大删会再次打穿账户级写配额）。
--
-- 参数：
--   archive.retention_days = 120  主库 45 天热窗口 + 归档 120 天 ≈ 165 天总历史。
--     2026-11-10 时点归档 >120 天的行有 47,257 行可清（19 天左右排完）。
--   archive.evict_max_rows = 2500→2000  给清理腾写配额：驱逐 ~34k + 清理 ~10k
--     + 非驱逐基线 ~40k ≈ 84k/日，账户级 100k/日红线内留 15% 余量
--     （2026-11-07 全天 100,953 踩线的教训）。
--
-- 删除仅作用于归档库；被清文章超出总历史窗口，收藏/历史中按设计不可再解析。

INSERT OR REPLACE INTO app_config (key, value) VALUES
  ('archive.retention_days', '120'),
  ('archive.evict_max_rows', '2000');

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '37');

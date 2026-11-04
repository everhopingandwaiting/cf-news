-- Migration 035: 驱逐提速 —— 热窗口 90→45 天、日帽 4000→10000 行，把主库压回 80%（400MB）
-- Applied: 2026-11-04
--
-- 背景：news-db 已到 450.7MB（500MB 免费档硬顶的 90.1%），逼近 96% 拒写红线。
-- 老配置 hot_days=90 下只有 90 天外的行可搬，当日帽 4000 行时清不动增量；
-- 且 90 天窗口内沉淀了 8 万行 news_items（含子表 + FTS）。
--
-- 计算（2026-11-04 实测）：
--   近30天 27,900 行 / 近45天 36,199 行 / 近60天 39,074 行 / 总量 80,371 行
--   → 窗口缩到 45 天产生 ~44,000 行待搬积压
--   → 日帽 10,000 行（*/5 自愈每轮最多 EVICT_MAX_BATCHES×EVICT_BATCH_SIZE=5000，
--     当日可迁满 10,000）：2-3 天达成 80%。达成后稳态只需 ~1,200 行/天（近期日增量），
--     帽内轻松维持。
--
-- 写入量评估：积压高峰日主库 rows_written 约 3.5 万（items+FTS+子表 DELETE）、
-- 归档库约 3.5 万（INSERT），两库各自独立限额 10 万/天，叠加正常抓取/摘要写入后
-- 仍在限额内；evictBatch 对配额类错误按批捕获落盘，次日自愈重试，不会半途丢数据。
--
-- retention（>30 天清 content 正文）顺序不变：正文先清，驱逐搬行不背大字段。
-- 代码里的 DEFAULT_HOT_DAYS/DEFAULT_EVICT_MAX_ROWS 保持 90/4000 不动——仅有配置行
-- 缺失时才用默认值，本迁移写入的行才是生产生效值。

INSERT OR REPLACE INTO app_config (key, value) VALUES
  ('archive.hot_days', '45'),
  ('archive.evict_max_rows', '10000');

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '35');

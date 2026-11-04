-- Migration 034: 源质量重排 —— 裁剪低产出英文源，启用实测正常的中文源
-- Applied: 2026-11-04
--
-- 背景：主库逼近 500MB（450.7MB / 90.1%），需要"减少无效抓取 + 中文优先"。
-- 无用户行为信号可用（全站收藏/评论/阅读记录为 0），质量判断改为
-- 近7天抓取量 × 平均正文长度（近30天，LEFT JOIN news_items 聚合）：
-- 排查命令与本迁移名单的详细数据见 commit message。
--
-- 禁用 9 个（正文稀薄/付费墙截断/英文版误配/死源）：
--   id 86  Bloomberg Markets   7天592条，平均正文 240 字符（付费墙残片）
--   id 75  Yonhap News English 7天528条，韩媒英文版，与"中文优先"冲突
--   id 33  The Japan Times     7天305条，平均正文 205 字符（英文版日媒）
--   id 8   CNBC                7天201条，平均正文 125 字符（纯标题流）
--   id 104 MarketWatch         7天147条，平均正文 139 字符（纯标题流）
--   id 70  人民日报             7天48条，平均正文 73 字符（纯标题流）
--   id 84  FT中文网             7天7条，平均正文 54 字符（付费墙残片）
--   id 88  独立鱼电影           30天仅4条，平均正文 37 字符
--   id 10  澎湃新闻             死源：镜像 feed 每轮只吐 1 条（029 已标记"另行排查"）
--
-- 启用 1 个（Workers 出口实测 2026-11-04，POST /api/admin/sources/:id/fetch）：
--   id 41  极客公园  feed 30 条，items=30 saved=30 全部入库 ✓
--
-- 跳过（本机 feed 有响应但从 Workers 出口无产出，启用只会变成死源）：
--   id 2  36氪  本机 feed 正常，但 Workers 出口仍被反爬挑战页挡住（030 时代问题未解）
--   id 91 丁香园 / id 71 人民网国际  feed 又冻结（最新条目 2025-08 / 2025-06），029 已停用过一次
--
-- 保留不动（量大但正文实、或属于核心栏目）：
--   V2EX（1506/7天）、东方财富策略研报（755/7天）经用户确认保留；IT之家/中新网财经等质量达标

-- 按禁用清单（id 精确匹配）
UPDATE news_sources SET enabled = 0 WHERE id IN (86, 75, 33, 8, 104, 70, 84, 88, 10);

-- 极客公园
UPDATE news_sources SET enabled = 1 WHERE id = 41;

INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '34');

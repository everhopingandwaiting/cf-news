# Cloudflare News Worker

基于 Cloudflare Workers 的每日新闻聚合应用，使用 D1 数据库存储，支持 RSS 源抓取、用户系统和收藏功能。

## 技术栈

- **计算**: Cloudflare Workers
- **框架**: Hono (轻量级 Web 框架)
- **数据库**: Cloudflare D1 (SQLite)
- **缓存**: Cloudflare KV
- **定时任务**: Cron Triggers (每 2 小时更新)

## 功能特性

- 📰 多源 RSS 新闻聚合
- 🔍 按分类过滤（科技、新闻、财经、娱乐）
- 🔎 关键词搜索
- 📊 趋势热词 & 热点追踪（基于 SMART IR + 中文停用词表）
- 🤖 AI 摘要、问答、今日要闻
- 👤 用户注册/登录、收藏、阅读历史
- 💬 WebSocket 实时评论
- ⭐ 收藏新闻
- 📖 阅读历史
- 🔔 推送通知
- 📱 响应式前端界面（React + Tailwind）
- ⏰ 每 2 小时自动更新

## 快速开始

### 前置条件

1. 安装 Docker
2. 拥有 Cloudflare 账号
3. 获取 Cloudflare API Token（需要 D1 和 Workers 权限）

### 1. 克隆项目

```bash
cd cf-news-worker
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，填入你的 Cloudflare API Token 和其他密钥
```

### 3. 生成配置并部署

```bash
cd ..
./deploy.sh
```

### 4. 初始化数据库

```bash
# schema.sql 建表（含 stop_words 等）
docker run --rm --env-file cf-news-worker/.env cf-news-worker \
  npx wrangler d1 execute news-db --remote --file=./src/db/schema.sql

# 导入停用词数据（2489 词：SMART IR + 哈工大+川大+百度中文 + HTML残留）
cd cf-news-worker
./scripts/import-stopwords.sh              # 生成 stopwords-import.sql
docker run --rm --env-file .env -v $(pwd)/src/db/stopwords-import.sql:/app/import.sql \
  cf-news-worker npx wrangler d1 execute news-db --remote --file=./import.sql

# 归档库初始化（冷热分库：cf-news-archive 只含 news 内容域表）
docker run --rm --env-file cf-news-worker/.env -v $(pwd)/cf-news-worker:/app -v /app/node_modules \
  cf-news-worker npx wrangler d1 execute cf-news-archive --remote --file=/app/migrations-archive/001-init.sql
```

后续增量变更用 `scripts/migrate.sh`（**默认双库**：主库 `news-db` ← `migrations/`、归档库 `cf-news-archive` ← `migrations-archive/`，`--database` 指定单个目标，`--check` 只看待应用清单）。

### 运维巡检

```bash
# D1 容量 + 驱逐健康（GitHub Actions 每日 07:00 UTC 也跑这个，见 .github/workflows/d1-capacity-check.yml）
CF_API_TOKEN=xxx D1_DATABASE_ID=xxx ARCHIVE_DATABASE_ID=xxx ./scripts/check-d1-capacity.sh
```

读 `file_size` 占比告警（免费档 500MB，实测 501MB 即拒绝一切写入；超限后驱逐自己也救不了，
它需要的 DELETE 同样被拒，只能先用 `wrangler d1 execute` 走管理 API 腾空间），
并检查 `kv_cache['archive:evict:last']` / `['retention:last']` 快照是否停更——
驱逐曾连续多日静默跳过且控制台日志不可读，快照 `at` 是唯一可靠信号。

## 项目结构

```
cf-news-worker/
├── src/
│   ├── index.ts          # 主入口和路由配置
│   ├── types.ts          # TypeScript 类型定义
│   ├── db/
│   │   └── schema.sql    # 数据库 Schema
│   ├── routes/
│   │   ├── auth.ts       # 认证路由（注册/登录）
│   │   ├── news.ts       # 新闻 API 路由
│   │   └── user.ts       # 用户相关路由（收藏/历史）
│   └── services/
│       └── newsFetcher.ts # RSS 抓取服务
├── public/               # 静态资源
├── wrangler.toml         # Cloudflare Worker 配置
├── Dockerfile            # Docker 配置
├── docker-compose.yml    # Docker Compose 配置
└── package.json          # NPM 依赖
```

## API 文档

### 公开接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/news` | 获取新闻列表 |
| GET | `/api/news/:id` | 获取新闻详情 |
| GET | `/api/news/sources/list` | 获取新闻源列表 |
| GET | `/api/news/categories/list` | 获取分类列表 |
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |

### 认证接口（需要 Bearer Token）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/me` | 获取当前用户信息 |
| GET | `/api/user/favorites` | 获取收藏列表 |
| POST | `/api/user/favorites/:newsId` | 添加收藏 |
| DELETE | `/api/user/favorites/:newsId` | 取消收藏 |
| GET | `/api/user/history` | 获取阅读历史 |
| POST | `/api/user/history/:newsId` | 标记已读 |
| DELETE | `/api/user/history` | 清空阅读历史 |

### 查询参数

- `page`: 页码（默认 1）
- `limit`: 每页数量（默认 20）
- `category`: 分类过滤（tech/news/finance/entertainment）
- `search`: 关键词搜索

## 添加新闻源

编辑 `src/db/schema.sql` 中的 INSERT 语句，或直接向数据库插入：

```sql
INSERT INTO news_sources (name, url, feed_url, category, language) 
VALUES ('源名称', '网站URL', 'RSS地址', '分类', '语言');
```

## 定时任务

Cron Triggers 配置为每天 5 个任务：

- `0 */2 * * *` — 每 2 小时抓取所有启用的新闻源（入队异步处理，不阻塞）。频率与健康检查阈值统一定义在 `src/cronSchedule.ts`，`routes/cron-schedule.test.ts` 断言其与 wrangler 配置一致、且阈值严格大于抓取间隔
- `*/5 * * * *` — 每 5 分钟处理积压 AI 摘要（newest-first，只处理近 7 天文章）
- `*/15 * * * *` — 每 15 分钟刷新趋势主题与雷达推送
- `0 8 * * *` — 每天 8 点生成并发送日报摘要
- `0 */6 * * *` — 每 6 小时自动刷新模型目录（modelRefresher：/models 校准 + 质量探针 + 证据裁剪，独立调度避免抢 subrequest 预算）

可在 `wrangler.toml` 中修改：

```toml
[triggers]
crons = ["0 */2 * * *", "*/5 * * * *", "*/15 * * * *", "0 8 * * *", "0 */6 * * *"]
```

## 测试

```bash
# 在 Docker 中运行所有测试
docker run --rm -v $(pwd):/app -v /app/node_modules --network=host cf-news-worker npx vitest run --reporter=verbose
```

测试使用 vitest + MockD1（内存中的 D1 模拟），不依赖 Cloudflare 远程服务。

### 测试文件

| 文件 | 说明 | 用例数 |
|------|------|--------|
| `routes/health.test.ts` | 健康检查端点 | 6 |
| `routes/auth.test.ts` | 用户注册/登录/个人信息 | 11 |
| `routes/news.test.ts` | 新闻列表/详情/分类/来源/搜索 | 24 |
| `routes/favorites.test.ts` | 收藏 CRUD（含归档文章水合） | 9 |
| `routes/history.test.ts` | 阅读历史 CRUD | 5 |
| `routes/comments.test.ts` | 评论 CRUD | 10 |
| `routes/user.test.ts` | 用户设置/推送订阅/稍后读/雷达 | 12 |
| `routes/admin.test.ts` | 管理后台 | 22 |
| `routes/ai.test.ts` | AI 摘要/问答/相关阅读 | 14 |
| `routes/entities.test.ts` | 结构化实体抽取 | 3 |
| `routes/operations.test.ts` | 手动操作（抓取/摘要/配图/翻译） | 27 |
| `routes/trending.test.ts` | 趋势数据 | 13 |
| `routes/image.test.ts` | 图片代理 | 3 |
| `routes/screenshot.test.ts` | 页面截图 | 3 |
| `routes/share.test.ts` | 分享 OG 卡片 | 3 |
| `routes/tts.test.ts` | TTS 代理 | 7 |
| `routes/pixabay-kw.test.ts` | Pixabay 关键词抽取 | 16 |
| `routes/pixabay-live.test.ts` | Pixabay 实时搜索 | 1 |
| `routes/queue-stock.test.ts` | 队列消息处理（摘要/吐槽/实体/配图） | 5 |
| `durable-objects/clipboard.test.ts` | 粘贴板 DO 协议 | 13 |
| `durable-objects/comments.test.ts` | 实时评论 DO 协议 | 6 |
| `durable-objects/piping.test.ts` | 文件传输 HTTP Piping | 7 |
| `services/archive.test.ts` | **冷热分库（跨库解析/水合/HTTP 双库路由/驱逐）** | 20 |
| `services/cache.test.ts` | 缓存工具（`kv_cache` 计数缓存 + 记忆层写容错） | 6 |
| `services/summarizer-pending.test.ts` | 摘要批量生成（含 KV 扫描节流） | 4 |
| `services/summarizer.test.ts` | 摘要/吐槽/多视角服务 | 5 |
| `services/retention.test.ts` | D1 保留清理（>30 天正文、>7 天日志） | 3 |
| `services/radarPush.test.ts` | 雷达命中推送（KV 去重水位下推） | 4 |
| `services/aiProvider.test.ts` | Provider 链调度/配置/模型评分 | 27 |
| `services/dedup.test.ts` | 哈希+向量去重（含跨库 URL 兜底） | 7 |
| `services/entityExtractor.test.ts` | 实体抽取解析与写入 | 5 |
| `services/newsFetcher.test.ts` | RSS 抓取管线 | 5 |
| `services/modelRefresher.test.ts` | 模型目录刷新/探针 | 14 |
| `services/trending.test.ts` | 趋势聚合辅助函数 | 7 |
| **合计** | | **327** |

### 测试架构

- **vitest** — 测试运行器
- **MockD1** — `MockD1` 类模拟 Cloudflare D1 绑定，支持 Drizzle ORM 生成的 SQL 模式（SELECT/INSERT/UPDATE/DELETE，含 JOIN、COUNT、GROUP BY、LIMIT/OFFSET、子查询）
- **hono/testing** — 通过 `app.fetch()` 发送 HTTP 请求测试路由
- **helpers.ts** — `buildTestApp()` 构建测试应用，`request()` 封装请求

## 注意事项

1. **RSS 源可用性**: 某些 RSS 源可能需要代理或有访问限制
2. **数据库限制**: D1 免费版有存储和请求限制（单库 500MB、账户 5GB；每日 5M 行读 / 50k 行写、账户级共享）——冷热分库把内容域拆到两库共享同一账户配额，写入密集任务需关注日预算
3. **Worker 限制**: 免费版每天 100,000 请求
4. **新闻清理**: 自动清理 30 天前的旧新闻

## 许可证

MIT
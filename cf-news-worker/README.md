# Cloudflare News Worker

基于 Cloudflare Workers 的每日新闻聚合应用，使用 D1 数据库存储，支持 RSS 源抓取、用户系统和收藏功能。

## 技术栈

- **计算**: Cloudflare Workers
- **框架**: Hono (轻量级 Web 框架)
- **数据库**: Cloudflare D1 (SQLite)
- **缓存**: Cloudflare KV
- **定时任务**: Cron Triggers (每小时更新)

## 功能特性

- 📰 多源 RSS 新闻聚合
- 🔍 按分类过滤（科技、新闻、财经、娱乐）
- 🔎 关键词搜索
- 👤 用户注册/登录
- ⭐ 收藏新闻
- 📖 阅读历史
- ⏰ 每小时自动更新
- 📱 响应式前端界面

## 快速开始

### 前置条件

1. 安装 Docker
2. 拥有 Cloudflare 账号
3. 获取 Cloudflare API Token（需要 D1 和 Workers 权限）

### 1. 克隆项目

```bash
cd /root/cf_ddns/cf-news-worker
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env 文件，填入你的 Cloudflare API Token
```

### 3. 创建 D1 数据库

```bash
# 使用 Docker 运行 wrangler
docker compose run --rm db-init

# 或者远程创建
docker compose run --rm deploy wrangler d1 create news-db
```

创建后会返回 database_id，更新 `wrangler.toml` 中的 `database_id`。

### 4. 创建 KV 命名空间

```bash
docker compose run --rm deploy wrangler kv namespace create KV
```

创建后会返回 namespace id，更新 `wrangler.toml` 中的 `id`。

### 5. 初始化数据库

```bash
# 本地开发数据库
docker compose run --rm db-init

# 远程生产数据库
docker compose run --rm deploy wrangler d1 execute news-db --remote --file=./src/db/schema.sql
```

### 6. 本地开发

```bash
docker compose up worker-dev
```

访问 http://localhost:8787 查看应用。

### 7. 部署到生产环境

```bash
docker compose --profile deploy run --rm deploy
```

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

Cron Triggers 配置为每小时执行一次（`0 * * * *`），自动抓取所有启用的新闻源。

可在 `wrangler.toml` 中修改：

```toml
[triggers]
crons = ["0 * * * *"]  # 每小时整点
```

## 注意事项

1. **RSS 源可用性**: 某些 RSS 源可能需要代理或有访问限制
2. **数据库限制**: D1 免费版有存储和请求限制
3. **Worker 限制**: 免费版每天 100,000 请求
4. **新闻清理**: 自动清理 30 天前的旧新闻

## 许可证

MIT
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
- 📊 趋势热词 & 热点追踪（基于 SMART IR + 中文停用词表）
- 🤖 AI 摘要、问答、今日要闻
- 👤 用户注册/登录、收藏、阅读历史
- 💬 WebSocket 实时评论
- ⭐ 收藏新闻
- 📖 阅读历史
- 🔔 推送通知
- 📱 响应式前端界面（React + Tailwind）
- ⏰ 每小时自动更新

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
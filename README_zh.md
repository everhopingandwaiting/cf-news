# CF News — 每日新闻聚合

[English](README.md)

基于 Cloudflare 边缘基础设施构建的每日新闻聚合平台。从 20+ 个来源收集 RSS 订阅，提供 AI 摘要，带来快速流畅的阅读体验。

## 亮点功能

### 跨设备粘贴板

实时同步文本和图片到你的所有设备。支持桌面端和移动端。

- **实时同步** — 输入或粘贴，其他设备立即看到
- **推送到剪贴板** — 点击「推送」，文本自动写入其他设备的系统剪贴板
- **图片支持** — 粘贴或选择图片，>5MB 自动压缩
- **离线队列** — 断网时消息排队，重连后自动发出
- **发送者标识** — 显示每条消息来自哪个设备
- **粘贴板历史** — 最近 20 条推送记录，点击可恢复
- **自动弹出** — 其他设备发来数据时面板自动打开
- **文件传输** — 拖拽或选择任意文件，WebSocket 分块流式传输，无硬性大小限制，实际速度取决于设备间网络状况。接收端弹出接受/拒绝提示，接受后自动下载。数据仅内存中转，服务端不持久化
- **安全可靠** — WSS 加密传输，数据仅在你的设备间流转，服务端不存储

## 功能特性

- **多源 RSS 聚合** — 20+ 内置源（36氪、少数派、Hacker News、TechCrunch、The Verge、BBC 等）
- **分类筛选** — 科技、AI、新闻、财经、娱乐
- **全文搜索** — D1 FTS5 驱动，KV 热缓存加速
- **AI 摘要** — OpenRouter、NVIDIA、Mango 多 provider 自动降级
- **AI 问答** — 自然语言提问，AI 基于当日新闻回答
- **今日要闻** — AI 每日自动汇总，按时间排序，携带语言标记和发布时间，支持历史浏览
- **相关推荐** — 标题关键词匹配，点击一键跳转
- **用户系统** — 注册、登录、JWT 认证
- **收藏与历史** — 收藏文章、记录阅读历史
- **评论系统** — WebSocket 实时评论，支持多设备同步
- **源管理** — 后台管理面板，增删改排 RSS 源
- **邮件摘要** — 订阅每日新闻邮件
- **自动更新** — Cron Triggers 每小时抓取新文章
- **响应式界面** — React 19 + Tailwind 4，适配桌面和移动端

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19, Vite 8, Tailwind 4, TypeScript 6 |
| 后端 | Hono v4 运行在 Cloudflare Workers |
| 数据库 | Cloudflare D1 (SQLite) |
| 缓存 | Cloudflare KV |
| 实时通信 | Durable Objects (WebSocket) |
| 搜索 | D1 FTS5 全文搜索 |
| AI 聊天 | Workers AI (LLaMA 3.3 70B) |
| AI 搜索 | Cloudflare AI Search（语义+关键词） |
| AI 摘要 | OpenRouter, NVIDIA, Mango APIs |
| 向量 | Vectorize 语义去重 |
| 浏览器 | Browser Rendering（无头 Chrome，抓取 JS 重度渲染的 RSS 源） |
| 队列 | Queues（异步新闻处理） |
| 部署 | Docker + Wrangler |

## Cloudflare 配置指南

部署前需要配置 Cloudflare 的多项服务。请仔细按步骤操作。

### 第一步：注册 Cloudflare 账号

1. 访问 [dash.cloudflare.com](https://dash.cloudflare.com) 注册账号
2. 添加你的域名（如 `example.com`）到 Cloudflare
3. 按提示将域名的 Nameserver 改为 Cloudflare 提供的地址

### 第二步：创建 API Token

这是最关键的一步，Token 需要特定权限。

1. 访问 [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
2. 点击 **"Create Token"**（创建令牌）
3. 选择 **"Custom token"**（自定义令牌，不要用模板）
4. 按以下配置设置：

**Token 名称：** `cf-news-deploy`（可自定义）

**权限** — 添加以下 4 行权限：

| 权限 | 资源 |
|------|------|
| **Account** → D1 → Edit | 你的账户 |
| **Account** → Workers Scripts → Edit | 你的账户 |
| **Account** → Workers KV Storage → Edit | 你的账户 |
| **Account** → Workers AI → Read | 你的账户 |

**Account resources：** 选择你的账户（通常自动识别）

**Zone resources：** 选择你的域名（如 `example.com`）

5. 点击 **"Continue to summary"** → **"Create Token"**
6. **立即复制 Token** — 页面刷新后无法再查看！

> ⚠️ **注意：** 不要用 "Global API Key"，请使用上述的 scoped API Token。

### 第三步：获取 Zone ID

1. 在 Cloudflare 进入你的域名管理页面
2. 右侧边栏找到 **"Zone ID"** — 点击复制
3. 保存备用

### 第四步：创建 D1 数据库

```bash
docker run --rm -e CLOUDFLARE_API_TOKEN=你的Token \
  cf-news-worker npx wrangler d1 create news-db
```

从输出中复制 `database_id`，后面配置 `.env` 需要。

### 第五步：创建 KV 命名空间

```bash
docker run --rm -e CLOUDFLARE_API_TOKEN=你的Token \
  cf-news-worker npx wrangler kv namespace create KV
```

从输出中复制 `id`，后面配置 `.env` 需要。

### 第六步：配置环境变量

编辑 `cf-news-worker/.env`，填入你的值：

```bash
CLOUDFLARE_API_TOKEN=第二步获取的Token
D1_DATABASE_ID=第四步获取的database_id
KV_NAMESPACE_ID=第五步获取的id
ZONE_ID=第三步获取的Zone ID
ROUTE_PATTERN=你的域名.com/*
JWT_SECRET=任意随机字符串用于JWT签名
OPENROUTER_API_KEY=你的OpenRouter密钥
NVIDIA_API_KEY=你的NVIDIA密钥
MANGO_API_KEY=你的Mango密钥
```

### 第七步：绑定自定义域名

首次部署后，需要绑定域名：

1. 进入 Cloudflare Dashboard → **Workers & Pages**
2. 点击你的 Worker（`cf-news-worker`）
3. 进入 **Settings** → **Triggers** → **Custom Domains**
4. 添加你的域名（如 `news.yourdomain.com`）

## CI/CD 配置（GitHub Actions）

项目自带 GitHub Actions 自动部署工作流。需要在仓库设置中添加以下 Secrets：

**Settings → Secrets and variables → Actions → New repository secret**

| Secret 名称 | 说明 |
|-------------|------|
| `CF_API_TOKEN` | Cloudflare API Token |
| `KV_NAMESPACE_ID` | KV 命名空间 ID |
| `ZONE_ID` | Cloudflare Zone ID |
| `ROUTE_PATTERN` | 域名路由（如 `yourdomain.com/*`） |
| `JWT_SECRET` | JWT 签名密钥 |
| `OPENROUTER_API_KEY` | OpenRouter API Key |
| `NVIDIA_API_KEY` | NVIDIA API Key |
| `MANGO_API_KEY` | Mango API Key |

工作流运行时会自动将这些值推到 Cloudflare Secrets（`wrangler secret put`），不会明文存储。推送到 main 分支即可触发自动部署。

## 快速开始

### 前置条件

- Docker
- Cloudflare 账号（见上方配置指南）
- Cloudflare API Token（见上方配置指南）

### 1. 克隆并配置

```bash
git clone <repo-url> cf-news
cd cf-news/cf-news-worker
cp .env.example .env
# 编辑 .env，填入你的 Cloudflare 凭据和 API 密钥
```

### 2. 生成配置并部署

```bash
cd ..
./deploy.sh
```

部署脚本自动完成：
- 从 `.env` 生成 `wrangler.toml`
- 构建前端
- 复制静态资源到 worker
- 构建 Docker 镜像
- 部署到 Cloudflare

### 3. 初始化数据库

```bash
docker run --rm --env-file cf-news-worker/.env cf-news-worker \
  npx wrangler d1 execute news-db --remote --file=./src/db/schema.sql
```

## 项目结构

```
cf-news/
├── cf-news-frontend/        # React 前端
│   └── src/
│       ├── components/      # UI 组件
│       ├── pages/           # 页面组件
│       ├── hooks/           # 自定义 Hooks
│       ├── api/             # API 客户端
│       └── types/           # TypeScript 类型定义
├── cf-news-worker/          # Hono API Worker
│   └── src/
│       ├── routes/          # API 路由（auth, news, user, admin, comments）
│       ├── services/        # 后台服务（抓取器、摘要生成器）
│       ├── durable-objects/ # WebSocket 房间（粘贴板、评论）
│       └── db/              # D1 Schema
├── deploy.sh                # 构建部署脚本
└── .github/workflows/       # CI/CD
```

## API 接口

### 公开接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/news` | 获取新闻列表（分页、可筛选） |
| GET | `/api/news/:id` | 获取新闻详情 |
| GET | `/api/news/sources/list` | 获取 RSS 源列表 |
| GET | `/api/comments/:newsId` | 获取新闻评论 |
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| GET | `/api/ai/digest` | 获取今日要闻 |
| GET | `/api/ai/digest?date=YYYY-MM-DD` | 获取指定日期要闻 |
| GET | `/api/ai/digest/dates` | 列出有要闻的日期 |
| GET | `/api/ai/related/:id` | 获取相关文章 |
| GET | `/api/health` | 健康检查 |
| GET | `/api/image?url=` | 图片代理（CF 边缘缓存） |

### 认证接口（需要 Bearer Token）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/auth/me` | 获取当前用户信息 |
| POST | `/api/comments/:newsId` | 发表评论 |
| DELETE | `/api/comments/:commentId` | 删除自己的评论 |
| GET | `/api/user/favorites` | 获取收藏列表 |
| POST | `/api/user/favorites/:id` | 添加收藏 |
| DELETE | `/api/user/favorites/:id` | 取消收藏 |
| GET | `/api/user/history` | 获取阅读历史 |
| POST | `/api/user/history/:id` | 标记已读 |
| POST | `/api/ai/ask` | AI 问答（支持流式响应） |
| POST | `/api/ai/digest/generate` | 强制重新生成要闻（管理） |

### 管理接口（需要 Bearer Token，管理员）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/admin/sources` | 获取所有 RSS 源（含统计） |
| POST | `/api/admin/sources` | 添加 RSS 源 |
| PUT | `/api/admin/sources/:id` | 更新 RSS 源 |
| DELETE | `/api/admin/sources/:id` | 删除 RSS 源 |
| POST | `/api/admin/sources/reorder` | 排序 RSS 源 |
| POST | `/api/admin/sources/refresh/:id` | 强制刷新某源 |
| GET | `/api/admin/stats` | 源统计信息 |

## 添加 RSS 源

编辑 `cf-news-worker/src/db/schema.sql` 或直接插入数据库：

```sql
INSERT INTO news_sources (name, url, feed_url, category, language)
VALUES ('源名称', 'https://example.com', 'https://example.com/rss', 'tech', 'zh');
```

## 默认新闻源

| 分类 | 中文源 | 英文源 |
|------|--------|--------|
| 科技 | 36氪、少数派、IT之家、爱范儿 | Hacker News、TechCrunch、The Verge、Ars Technica、Wired |
| AI | 机器之心、量子位、AI 前线 | OpenAI Blog、Hugging Face、Google AI、DeepMind、Anthropic |
| 新闻 | 澎湃新闻 | Reuters、BBC News、NPR |

## 许可证

MIT

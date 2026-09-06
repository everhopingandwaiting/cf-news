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
- **文件传输** — HTTP 流模式适合 100MB 内文件，WSS 分片模式保留大文件能力。支持拖拽、进度、取消/重试、可信设备自动接受，以及可选的全局自动接受开关。数据仅内存中转，服务端不持久化
- **设备控制** — 在线设备、可信设备、私密模式、临时文本投递链接
- **安全可靠** — WSS 加密传输，数据仅在你的设备间流转，服务端不存储

## 功能特性

- **多源 Feed 聚合** — 30+ 内置 RSS/JSON Feed 源（36氪、Hacker News、TechCrunch、BBC、Daring Fireball 等）
- **分类筛选** — 科技、AI、新能源、新闻、财经、娱乐
- **全文搜索** — D1 FTS5 驱动，KV 热缓存加速
- **AI 摘要** — OpenRouter、NVIDIA、Mango 多 provider 自动降级
- **AI 问答** — 自然语言提问，AI 基于当日新闻回答
- **今日要闻** — AI 每日自动汇总，按时间排序，携带语言标记和发布时间，支持历史浏览
- **相关推荐** — 标题关键词匹配，点击一键跳转
- **趋势主题** — 趋势面板含主题聚合、代表新闻、词云、突发检测、AI 解读，支持多关键词对比、来源/分类每小时分布
- **新闻探索** — 事件时间线、观点光谱、结构化实体提取、新闻地图、可信度参考、关键词雷达、稍后读和反信息茧房推荐
- **阅读模式** — 全文提取，深/浅色主题，阅读时间估算，完善的排版（标题、图片、表格、代码块）
- **站内浏览** — 内嵌 iframe 查看原文，或通过 Browser Rendering 截图查看
- **语音速度** — 播报速度可调（0.5x–1.5x）
- **推送通知** — 订阅浏览器推送，接收最新消息通知
- **用户系统** — 注册、登录、JWT 认证
- **收藏与历史** — 收藏文章、记录阅读历史
- **稍后读与雷达** — 保存待读文章，设置关键词并查看最新命中
- **评论系统** — WebSocket 实时评论，支持多设备同步
- **源管理** — 后台管理面板，增删改排 RSS 源
- **邮件摘要** — 订阅每日新闻邮件
- **自动更新** — Cron Triggers 每小时抓取新文章
- **语音播报** — 浏览器原生 SpeechSynthesis，免费离线
- **AI 分类** — LLaMA 按内容准确分类，不依赖 RSS 源
- **机器人防护** — Turnstile 验证码保护注册/登录
- **边缘缓存** — 新闻列表 CF 边缘缓存（60s）+ Cache Rules（哈希资源 1 年、图片代理 7 天）
- **图片代理 R2 缓存** — 外部图片经 CF 边缘代理并缓存到 R2（10GB 免费、0 出网费）
- **AI 插画持久化** — AI 生成插画存入 R2，不受临时 URL 失效影响
- **Pixabay 图库配图** — 无图新闻卡片自动填充相关 Pixabay 插画（下载到 R2 自托管，符合热链规范）；卡片显示「配图」标记，明确区分自动生成图与源站原图
- **全球服务排行** — Cloudflare Radar 互联网服务排名补充趋势面板
- **使用分析** — Workers Analytics Engine 记录搜索热词与各 provider AI 调用统计
- **自动模型目录同步** — 独立定时任务（`0 */6 * * *`）自动将 `provider_models` 目录与各 provider 的 live `/models` 端点校准，对新候选做真实质量探针，并根据 `ai_call_log` 证据裁剪死模型。自动识别免费模型（OpenRouter `:free`、Zen/OrcaRouter `-free`、零价），并优先探测、给予加分使其优先于同类付费模型。新模型默认禁用，只有探针成功才启用，无需手动迁移。也可通过 `POST /api/admin/refresh-models` 手动触发
- **可靠回填** — 后台回填任务改为 Cloudflare Workflows（自动重试、跨请求存活）
- **Smart Placement** — Worker 自动靠近上游 AI/RSS 端点，降低延迟
- **邮件退订** — 回复 "退订" 到 digest@ 即可关闭每日摘要（Email Routing 入站）
- **隐私友好分析** — Cloudflare Web Analytics beacon（无 Cookie）
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
| AI 缓存 | AI Gateway（分类和问答结果缓存） |
| 机器人防护 | Turnstile（免费无感验证码） |
| 边缘缓存 | Cache API（新闻列表 60s 缓存） |
| AI 摘要 | OpenRouter, NVIDIA, Mango, Zen（1M 上下文大批量）, OrcaRouter, 智谱 GLM（免费）, SenseNova（商汤）APIs |
| 向量 | Vectorize 语义去重 |
| 对象存储 | R2（图片代理缓存 + AI 插画） |
| 持久任务 | Workflows（回填任务） |
| 分析 | Analytics Engine（搜索/AI 统计）+ Web Analytics（流量） |
| 全球趋势 | Radar API（互联网服务排名） |
| 邮件入站 | Email Routing（摘要退订） |
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

### 第六步：创建 Turnstile 验证码（机器人防护）

1. 前往 [dash.cloudflare.com/?to=/:account/turnstile](https://dash.cloudflare.com/?to=/:account/turnstile)
2. 点击 **"Add widget"**
3. Widget 名称：`cf-news`，域名：`news.slivermoss.site`（或你的域名），模式：**Invisible**
4. 复制 **Site Key** 和 **Secret Key**，填入 `.env` 的 `TURNSTILE_SITE_KEY` 和 `TURNSTILE_SECRET`

### 第七步：配置环境变量

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
GROQ_API_KEY=你的Groq密钥
FREEMODEL_API_KEY=你的Freemodel密钥
ZEN_API_KEY=你的Zen密钥            # 从 opencode.ai/zen 获取（聚合 API：Claude/GPT/Gemini/DeepSeek/Kimi + 8 个免费模型）
ORCAROUTER_API_KEY=你的OrcaRouter密钥  # 从 orcarouter.ai 获取（聚合 API：Claude/GPT/Gemini/DeepSeek/Qwen；含免费模型）
ZHIPU_API_KEY=你的智谱密钥           # 从 open.bigmodel.cn 获取（GLM 免费模型：glm-4.7-flash / glm-4-flash-250414）
SENSENOVA_API_KEY=你的商汤密钥           # 从 platform.sensenova.cn 获取（token.sensenova.cn/v1：DeepSeek/SenseChat 模型）
TURNSTILE_SECRET=你的Turnstile密钥       # 从 CF 面板获取
TURNSTILE_SITE_KEY=0x4AAAA...             # 从 CF 面板获取
PIXABAY_API_KEY=你的Pixabay密钥            # 从 pixabay.com/api/docs 免费获取
```

### 第八步：绑定自定义域名

首次部署后，需要绑定域名：

1. 进入 Cloudflare Dashboard → **Workers & Pages**
2. 点击你的 Worker（`cf-news-worker`）
3. 进入 **Settings** → **Triggers** → **Custom Domains**
4. 添加你的域名（如 `news.yourdomain.com`）

### 第九步：创建 R2 Bucket（图片缓存 + AI 插画）

`wrangler.toml` 已绑定 `cf-news-images` 桶到 `R2_IMAGES`，首次部署前创建一次：

```bash
docker run --rm --env-file cf-news-worker/.env \
  -v $(pwd)/cf-news-worker:/app -v /app/node_modules --network=host \
  cf-news-worker npx wrangler r2 bucket create cf-news-images
```

### 第十步：Email Routing 入站（邮件退订）

1. Dashboard → **Compute > Email Service > Email Routing** → 为域名启用
2. 添加路由规则：模式 `digest@你的域名.com` → 动作 **发送到 Worker** → `cf-news-worker`
3. 用户回复 "退订"（或 unsubscribe/stop）到 digest@ 即可关闭每日摘要

### 第十一步：Radar API Token（全球趋势排行）

`/api/news/trending/radar` 端点需要一个带 `Account > Radar > Read` 权限的 token：

```bash
grep "^CLOUDFLARE_API_TOKEN=" cf-news-worker/.env | cut -d= -f2- | \
  docker run --rm -i --env-file cf-news-worker/.env \
  -v $(pwd)/cf-news-worker:/app -v /app/node_modules --network=host \
  cf-news-worker npx wrangler secret put RADAR_API_TOKEN
```

### 第十二步：Web Analytics（流量统计）

1. Dashboard → **Analytics > Web Analytics** → 为你的域名创建站点
2. 复制 beacon token（形如 `0x...`）替换 `cf-news-frontend/index.html` 中的 `VITE_WEB_ANALYTICS_TOKEN`

### 第十三步（可选）：Zero Trust Access（后台保护）

为管理界面加一层 Cloudflare Access 保护（免费 50 用户）：

1. Dashboard → **Zero Trust** → **Access > Applications** → 添加应用
2. 域名：`news.yourdomain.com`；路径：`/api/admin/*` 和 `/admin`
3. 策略：允许你的邮箱 / 任何有效会话 → 保存

哈希资源（1 年）和图片代理（7 天）的 Cache Rules 已通过 ruleset API 配置，也可在 Dashboard → **Rules > Cache Rules** 查看。

### 第十四步（可选）：Pixabay API Key（无图新闻自动配图）

无图新闻卡片可自动填充相关 Pixabay 插画（免费，100 次/分钟）。在 [pixabay.com](https://pixabay.com/api/docs/) 注册获取 key 并推送为 secret：

```bash
grep "^PIXABAY_API_KEY=" cf-news-worker/.env | cut -d= -f2- | \
  docker run --rm -i --env-file cf-news-worker/.env \
  -v $(pwd)/cf-news-worker:/app -v /app/node_modules --network=host \
  cf-news-worker npx wrangler secret put PIXABAY_API_KEY
```

随后可对最近的无图新闻批量配图（需要管理员 JWT）：

```bash
curl -X POST -H "Authorization: Bearer <管理员token>" \
  https://news.yourdomain.com/api/illustrate-stock -d '{"limit":20}'
```

插画下载到 R2 自托管（符合 Pixabay 禁止热链条款），经现有 `/api/image` 代理提供。未配置 key 时该端点返回 502，卡片保持纯文字布局。

## CI/CD 配置（GitHub Actions）

项目自带 GitHub Actions 自动部署工作流。需要在仓库设置中添加以下 Secrets：

**Settings → Secrets and variables → Actions → New repository secret**

| Secret 名称 | 说明 |
|-------------|------|
| `CF_API_TOKEN` | Cloudflare API Token |
| `D1_DATABASE_ID` | D1 数据库 ID |
| `KV_NAMESPACE_ID` | KV 命名空间 ID |
| `ZONE_ID` | Cloudflare Zone ID |
| `ROUTE_PATTERN` | 域名路由（如 `yourdomain.com/*`） |
| `JWT_SECRET` | JWT 签名密钥 |
| `OPENROUTER_API_KEY` | OpenRouter API Key |
| `NVIDIA_API_KEY` | NVIDIA API Key |
| `MANGO_API_KEY` | Mango API Key |
| `GROQ_API_KEY` | Groq API Key |
| `FREEMODEL_API_KEY` | Freemodel API Key |
| `ZEN_API_KEY` | Zen API Key（opencode.ai/zen — 聚合 AI 供应商） |
| `ORCAROUTER_API_KEY` | OrcaRouter API Key（orcarouter.ai — 聚合 AI 供应商，含免费模型） |
| `ZHIPU_API_KEY` | 智谱 AI API Key（open.bigmodel.cn — GLM 免费模型） |
| `SENSENOVA_API_KEY` | 商汤 SenseNova API Key（token.sensenova.cn — DeepSeek/SenseChat 模型） |
| `TURNSTILE_SECRET` | Turnstile 验证码密钥 |
| `TURNSTILE_SITE_KEY` | Turnstile 站点 Key |
| `PIXABAY_API_KEY` | Pixabay 免费图库 Key（无图新闻自动配图） |

工作流运行时会自动将这些值推到 Cloudflare Secrets（`wrangler secret put`），不会明文存储。

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
- 构建前端（Docker 内）
- 执行待应用的 D1 migrations
- 复制静态资源到 worker
- 部署到 Cloudflare

### 3. 初始化数据库与停用词

```bash
# 建表（源码通过 volume mount，镜像不打包代码）
docker run --rm --env-file cf-news-worker/.env \
  -v $(pwd)/cf-news-worker:/app \
  -v /app/node_modules \
  cf-news-worker npx wrangler d1 execute news-db --remote --file=./src/db/schema.sql

# 导入停用词（SMART IR 英文 + 哈工大/川大/百度中文 + HTML 残留词）
cd cf-news-worker
./scripts/import-stopwords.sh              # 生成 stopwords-import.sql
docker run --rm --env-file .env \
  -v $(pwd):/app \
  -v /app/node_modules \
  cf-news-worker npx wrangler d1 execute news-db --remote --file=./src/db/stopwords-import.sql
cd ..
```

首次初始化后，使用 `cf-news-worker/scripts/migrate.sh` 或 `./deploy.sh` 应用增量 D1 schema 变更。`deploy.sh` 会自动执行待应用的 migrations。

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
| GET | `/api/news/trending?hours=24` | 趋势热词（含来源/突发/变化/新词/掉出榜） |
| GET | `/api/news/trending/overview?hours=24` | AI 今日新闻格局概览（KV 缓存 30 分钟） |
| GET | `/api/news/trending/theme-perspectives?keyword=X&hours=24` | 热词多视角分析（跨媒体报道观点对比） |
| GET | `/api/news/trending/themes?hours=24` | 趋势主题聚合与代表新闻 |
| GET | `/api/news/trending/topics?hours=24` | 热点追踪时间序列 |
| GET | `/api/news/trending/categories?hours=24` | 分类分布 |
| GET | `/api/news/trending/compare?keywords=a,b,c&hours=48` | 多关键词时间序列对比 |
| GET | `/api/news/trending/hourly?hours=24` | 每小时来源与分类分布 |
| GET | `/api/news/trending/radar` | Cloudflare Radar 全球互联网服务排名 |
| GET | `/api/news/trending/overview?hours=24` | AI 今日新闻格局概览（KV 缓存 30 分钟） |
| GET | `/api/news/trending/theme-perspectives?keyword=X&hours=24` | 主题 AI 多视角分析 |
| GET | `/api/news/timeline?keyword=AI&hours=168` | 关键词事件时间线 |
| GET | `/api/news/map?hours=48` | 基于近期新闻推断地区分布 |
| GET | `/api/news/fresh-view?exclude=tech,ai` | 反信息茧房推荐 |
| GET | `/api/news/:id/credibility` | 来源多样性与交叉验证参考 |
| GET | `/api/news/:id/perspectives` | 基于相关文章生成观点光谱 |
| GET | `/api/news/:id/entities` | 获取文章结构化实体 |
| GET | `/api/news/:id/content` | 获取文章全文 |
| GET | `/api/comments/:newsId` | 获取新闻评论 |
| POST | `/api/auth/register` | 用户注册 |
| POST | `/api/auth/login` | 用户登录 |
| GET | `/api/ai/digest` | 获取今日要闻 |
| GET | `/api/ai/digest?date=YYYY-MM-DD` | 获取指定日期要闻 |
| GET | `/api/ai/digest/dates` | 列出有要闻的日期 |
| GET | `/api/ai/related/:id` | 获取相关文章 |
| GET | `/api/health` | 健康检查 |
| GET | `/api/health/feed` | 数据新鲜度检查 —— 6 小时无新新闻或 fetch cron 心跳缺失 2 小时时返回 `ok:false`（供 UptimeRobot 等外部监控探测） |
| GET | `/api/image?url=` | 图片代理（CF 边缘缓存） |
| GET | `/api/screenshot?url=` | 网页截图（Browser Rendering） |
| GET | `/api/config` | 公共配置（Turnstile 站点 key 等） |

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
| GET | `/api/user/read-later` | 获取稍后读列表 |
| POST | `/api/user/read-later/:id` | 加入稍后读 |
| DELETE | `/api/user/read-later/:id` | 移出稍后读 |
| GET | `/api/user/radar?hours=48` | 获取雷达关键词与命中文章 |
| POST | `/api/user/radar` | 添加雷达关键词 |
| DELETE | `/api/user/radar/:keyword` | 删除雷达关键词 |
| POST | `/api/ai/ask` | AI 问答（支持流式响应） |
| POST | `/api/ai/digest/generate` | 强制重新生成要闻（管理） |
| POST | `/api/ai/trending/insight` | AI 趋势解读 |
| POST | `/api/user/push/subscribe` | 订阅推送通知 |
| DELETE | `/api/user/push/unsubscribe` | 取消订阅推送通知 |
| POST | `/api/illustrate-stock/:newsId` | 单条无图新闻自动填充 Pixabay 插画 |
| POST | `/api/illustrate-stock` | 批量填充无图新闻（默认 10 条，上限 20；body 传 `{limit}`） |

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
| POST | `/api/admin/backfill-vectors` | 为旧新闻回填语义去重向量（后台，每批 500 条） |
| POST | `/api/admin/backfill-entities` | 为缺少实体的新闻回填结构化实体抽取（后台，每批 50 条） |
| POST | `/api/admin/refresh-models` | 手动触模型目录同步（校准 + 质量探针 + 证据裁剪，后台） |

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

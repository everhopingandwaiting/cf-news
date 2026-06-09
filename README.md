# CF News

[中文文档](README_zh.md)

A daily news aggregation platform built on Cloudflare's edge infrastructure. Collects RSS feeds from 30+ sources, provides AI-powered summaries, and delivers a fast reading experience.

## Highlights

### Cross-Device Clipboard Sharing

Sync text and images across your devices in real-time. Works on desktop and mobile.

- **Real-time sync** — Type or paste, other devices see it instantly
- **Push to clipboard** — Click "Push" to auto-copy text to other devices' system clipboard
- **Image support** — Paste or select images, auto-compress if >5MB
- **Offline queue** — Messages queued when disconnected, sent on reconnect
- **Sender identification** — See which device sent each message
- **Clipboard history** — Last 20 pushed texts, click to restore
- **Auto-open panel** — Panel opens automatically when data arrives from another device
- **File transfer** — Choose HTTP streaming for files up to 100MB, or WSS chunking for large files. Supports drag & drop, progress, cancel/retry, trusted-device auto-accept, and an optional auto-accept switch. Data is relayed in-memory only — never persisted on the server
- **Device controls** — Online devices, trusted devices, private mode, and temporary text handoff links
- **Secure** — WSS encrypted, data only flows between your devices, not stored on server

### News Q&A

Ask questions about today's news and get AI-generated answers with context. Click the title or icon to open the chat panel.

### Daily Digest

AI-generated summary of today's top news, sorted by time with language markers ([CN]/[EN]) and publish time. Collapsible card with copy and regenerate support. Browse historical digests via the date picker.

## Features

- **Multi-source RSS aggregation** — 30+ built-in sources (36氪, Hacker News, TechCrunch, The Verge, BBC, 世纪新能源网, etc.)
- **Category filtering** — Tech, AI, New Energy, News, Finance, Entertainment
- **Full-text search** — D1 FTS5 powered search with KV hot cache
- **AI summaries** — OpenRouter, NVIDIA, Mango APIs with automatic fallback
- **AI Q&A** — Ask natural language questions about news
- **Daily digest** — Auto-generated daily news summary with history browser
- **Related articles** — Keyword-matched related articles with one-click navigation
- **Trending keywords** — Real-time trending panel with word cloud, burst detection, new keyword badges, dropped keywords, AI insights, and hourly source/category distribution
- **Reader mode** — Full article content extraction with dark/light themes, reading time estimate, and rich typography
- **In-app source browsing** — Browse original article in an iframe, or take a screenshot via Cloudflare Browser Rendering
- **TTS speed control** — Adjustable playback speed (0.5x–1.5x) for voice narration
- **Push notifications** — Subscribe to browser push notifications for breaking news
- **User system** — Registration, login, JWT authentication
- **Favorites & history** — Bookmark articles, track read history
- **Comments** — Real-time WebSocket comments on news articles
- **Source manager** — Admin panel to add, edit, delete, and reorder RSS sources
- **Email digest** — Subscribe to daily news summaries
- **Auto-update** — Cron triggers fetch new articles every hour
- **News voice playback** — Browser-native SpeechSynthesis, free, no API calls
- **AI classification** — LLaMA 3.1 8B classifies news by content, not source defaults
- **Bot protection** — Turnstile verification on login/register
- **Edge caching** — News list cached on CF edge (60s) for faster response
- **Responsive UI** — React 19 + Tailwind 4, works on desktop and mobile

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 19, Vite 8, Tailwind 4, TypeScript 6 |
| Backend | Hono v4 on Cloudflare Workers |
| Database | Cloudflare D1 (SQLite) |
| Cache | Cloudflare KV |
| Real-time | Durable Objects (WebSocket) |
| Search | D1 FTS5 full-text search |
| AI Chat | Workers AI (LLaMA 3.3 70B) |
| AI Search | Cloudflare AI Search (semantic + keyword) |
| AI Cache | AI Gateway (caches classification, Q&A) |
| Bot Protection | Turnstile (free, no CAPTCHA) |
| Edge Cache | Cache API (news list 60s) |
| Summaries | OpenRouter, NVIDIA, Mango APIs |
| Vector | Vectorize for semantic dedup |
| Browser | Browser Rendering (headless Chrome for JS-heavy RSS) |
| Queue | Queues (async news processing) |
| Rate Limit | Cloudflare Rate Limiting |
| Deploy | Docker + Wrangler |

## Cloudflare Setup Guide

Before deploying, you need to configure several Cloudflare services.

### Step 1: Create a Cloudflare Account

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) and sign up
2. Add your domain (e.g., `example.com`) to Cloudflare
3. Update your domain's nameservers to Cloudflare's (they'll guide you through this)

### Step 2: Create an API Token

This is the most important step. The token needs specific permissions.

1. Go to [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click **"Create Token"**
3. Choose **"Custom token"** (not a template)
4. Configure the token with these settings:

**Token name:** `cf-news-deploy` (or any name you prefer)

**Permissions** — Add these 4 permission rows:

| Permission | Resource |
|------------|----------|
| **Account** → D1 → Edit | Your account |
| **Account** → Workers Scripts → Edit | Your account |
| **Account** → Workers KV Storage → Edit | Your account |
| **Account** → Workers AI → Read | Your account |

**Account resources:** Select your account (usually auto-detected)

**Zone resources:** Select your domain zone (e.g., `example.com`)

5. Click **"Continue to summary"** → **"Create Token"**
6. **Copy the token immediately** — it won't be shown again!

> ⚠️ **Important:** Do NOT use the "Global API Key". Use a scoped API Token as described above.

### Step 3: Get Your Zone ID

1. Go to your domain's dashboard on Cloudflare
2. On the right sidebar, find **"Zone ID"** — click to copy
3. Save this for later

### Step 4: Create D1 Database

```bash
docker run --rm -e CLOUDFLARE_API_TOKEN=your-token-here \
  cf-news-worker npx wrangler d1 create news-db
```

Copy the `database_id` from the output — you'll need it for `.env`.

### Step 5: Create KV Namespace

```bash
docker run --rm -e CLOUDFLARE_API_TOKEN=your-token-here \
  cf-news-worker npx wrangler kv namespace create KV
```

Copy the `id` from the output — you'll need it for `.env`.

### Step 6: Create Turnstile Widget (Bot Protection)

1. Go to [dash.cloudflare.com/?to=/:account/turnstile](https://dash.cloudflare.com/?to=/:account/turnstile)
2. Click **"Add widget"**
3. Widget name: `cf-news`, Domain: `news.slivermoss.site` (or your domain), Mode: **Invisible**
4. Copy the **Site Key** and **Secret Key** — add them to `.env` as `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET`

### Step 7: Configure Environment Variables

Edit `cf-news-worker/.env` with your values:

```bash
CLOUDFLARE_API_TOKEN=your-api-token-from-step-2
D1_DATABASE_ID=your-d1-database-id-from-step-4
KV_NAMESPACE_ID=your-kv-namespace-id-from-step-5
ZONE_ID=your-zone-id-from-step-3
ROUTE_PATTERN=your-domain.com/*
JWT_SECRET=any-random-string-for-jwt-signing
OPENROUTER_API_KEY=your-openrouter-key
NVIDIA_API_KEY=your-nvidia-key
MANGO_API_KEY=your-mango-key
GROQ_API_KEY=your-groq-key
FREEMODEL_API_KEY=your-freemodel-key
TURNSTILE_SECRET=your-turnstile-secret    # from dashboard
TURNSTILE_SITE_KEY=0x4AAAA...            # from dashboard
```

### Step 8: Add Custom Domain to Workers

After first deploy, add your domain:

1. Go to Cloudflare Dashboard → **Workers & Pages**
2. Click your worker (`cf-news-worker`)
3. Go to **Settings** → **Triggers** → **Custom Domains**
4. Add your domain (e.g., `news.yourdomain.com`)

## CI/CD Setup (GitHub Actions)

The project includes a GitHub Actions workflow for automatic deployment. To use it, configure these secrets in your repository:

**Settings → Secrets and variables → Actions → New repository secret**

| Secret Name | Description |
|-------------|-------------|
| `CF_API_TOKEN` | Cloudflare API Token (from Step 2) |
| `D1_DATABASE_ID` | D1 database ID |
| `KV_NAMESPACE_ID` | KV namespace ID |
| `ZONE_ID` | Cloudflare Zone ID |
| `ROUTE_PATTERN` | Your domain route (e.g., `yourdomain.com/*`) |
| `JWT_SECRET` | JWT signing secret |
| `OPENROUTER_API_KEY` | OpenRouter API key |
| `NVIDIA_API_KEY` | NVIDIA API key |
| `MANGO_API_KEY` | Mango API key |
| `GROQ_API_KEY` | Groq API key |
| `FREEMODEL_API_KEY` | Freemodel API key |
| `TURNSTILE_SECRET` | Turnstile secret key (bot protection) |
| `TURNSTILE_SITE_KEY` | Turnstile site key |

Secrets are automatically pushed to Cloudflare Secrets (`wrangler secret put`) during the workflow run.

## Quick Start

### Prerequisites

- Docker
- Cloudflare account (see setup guide above)
- Cloudflare API Token (see setup guide above)

### 1. Clone & configure

```bash
git clone <repo-url> cf-news
cd cf-news/cf-news-worker
cp .env.example .env
# Edit .env with your Cloudflare credentials and API keys
```

### 2. Generate config & deploy

```bash
cd ..
./deploy.sh
```

The deploy script automatically:
- Generates `wrangler.toml` from `.env`
- Builds the frontend (Docker)
- Applies pending D1 migrations
- Copies assets to worker
- Deploys to Cloudflare

### 3. Initialize database & import stop words

```bash
# Create tables
docker run --rm --env-file cf-news-worker/.env \
  -v $(pwd)/cf-news-worker:/app \
  -v /app/node_modules \
  cf-news-worker npx wrangler d1 execute news-db --remote --file=./src/db/schema.sql

# Import stop words (SMART IR English + 哈工大/川大/百度 Chinese + HTML)
cd cf-news-worker
./scripts/import-stopwords.sh              # generate stopwords-import.sql
docker run --rm --env-file .env \
  -v $(pwd):/app \
  -v /app/node_modules \
  cf-news-worker npx wrangler d1 execute news-db --remote --file=./src/db/stopwords-import.sql
cd ..
```

After the first initialization, use `cf-news-worker/scripts/migrate.sh` or `./deploy.sh` to apply incremental D1 schema changes. `deploy.sh` runs pending migrations automatically.

## Project Structure

```
cf-news/
├── cf-news-frontend/        # React frontend
│   └── src/
│       ├── components/      # UI components
│       ├── pages/           # Page components
│       ├── hooks/           # Custom hooks
│       ├── api/             # API client
│       └── types/           # TypeScript types
├── cf-news-worker/          # Hono API worker
│   └── src/
│       ├── routes/          # API routes (auth, news, user, admin, comments)
│       ├── services/        # Background services (fetcher, summarizer)
│       ├── durable-objects/ # WebSocket rooms (clipboard, comments)
│       └── db/              # D1 schema
├── deploy.sh                # Build & deploy script
└── .github/workflows/       # CI/CD
```

## API Endpoints

### Public

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/news` | List news (paginated, filterable) |
| GET | `/api/news/:id` | Get news detail |
| GET | `/api/news/sources/list` | List RSS sources |
| GET | `/api/news/trending?hours=24` | Trending keywords (sources, burst, change, is_new, dropped) |
| GET | `/api/news/trending/topics?hours=24` | Trending topics time series |
| GET | `/api/news/trending/categories?hours=24` | Category distribution of trending content |
| GET | `/api/news/trending/compare?keywords=a,b,c&hours=48` | Multi-keyword time series comparison |
| GET | `/api/news/trending/hourly?hours=24` | Hourly source & category distribution |
| GET | `/api/news/:id/content` | Fetch full article content |
| GET | `/api/comments/:newsId` | Get comments for a news item |
| POST | `/api/auth/register` | Register |
| POST | `/api/auth/login` | Login |
| GET | `/api/ai/digest` | Get today's daily digest |
| GET | `/api/ai/digest?date=YYYY-MM-DD` | Get digest for a specific date |
| GET | `/api/ai/digest/dates` | List available digest dates |
| GET | `/api/ai/related/:id` | Get related articles |
| GET | `/api/health` | Health check |
| GET | `/api/image?url=` | Image proxy via CF edge cache |
| GET | `/api/screenshot?url=` | Page screenshot via Browser Rendering |
| GET | `/api/config` | Public config (Turnstile site key, etc.) |

### Authenticated (Bearer token)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/auth/me` | Current user info |
| POST | `/api/comments/:newsId` | Post a comment |
| DELETE | `/api/comments/:commentId` | Delete own comment |
| GET | `/api/user/favorites` | List favorites |
| POST | `/api/user/favorites/:id` | Add favorite |
| DELETE | `/api/user/favorites/:id` | Remove favorite |
| GET | `/api/user/history` | Read history |
| POST | `/api/user/history/:id` | Mark as read |
| POST | `/api/ai/ask` | Ask a question about news (supports streaming) |
| POST | `/api/ai/digest/generate` | Force regenerate digest (admin only) |
| POST | `/api/ai/trending/insight` | AI-generated insight for trending keyword |
| POST | `/api/user/push/subscribe` | Subscribe to push notifications |
| DELETE | `/api/user/push/unsubscribe` | Unsubscribe from push notifications |

### Admin (Bearer token, admin user only)

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/admin/sources` | List all RSS sources (with stats) |
| POST | `/api/admin/sources` | Add a new RSS source |
| PUT | `/api/admin/sources/:id` | Update an RSS source |
| DELETE | `/api/admin/sources/:id` | Delete an RSS source |
| POST | `/api/admin/sources/reorder` | Reorder sources |
| POST | `/api/admin/sources/refresh/:id` | Force refresh a source |
| GET | `/api/admin/stats` | Source statistics |

## Adding RSS Sources

Edit `cf-news-worker/src/db/schema.sql` or insert directly:

```sql
INSERT INTO news_sources (name, url, feed_url, category, language)
VALUES ('Source Name', 'https://example.com', 'https://example.com/rss', 'tech', 'en');
```

## License

MIT

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

- **Multi-source feed aggregation** — 30+ built-in RSS/JSON Feed sources (36氪, Hacker News, TechCrunch, The Verge, BBC, Daring Fireball, CNBC, etc.)
- **Category filtering** — Tech, AI, New Energy, News, Finance, Entertainment
- **Full-text search** — D1 FTS5 powered search with KV hot cache
- **AI summaries** — OpenRouter, NVIDIA, Mango APIs with automatic fallback
- **AI Q&A** — Ask natural language questions about news
- **Daily digest** — Auto-generated daily news summary with history browser
- **Related articles** — Keyword-matched related articles with one-click navigation
- **Trending themes** — Real-time trend panel with topic clusters, representative articles, word cloud, burst detection, AI insights, and hourly source/category distribution
- **News exploration** — Event timelines, viewpoint spectrum, structured entity extraction, inferred news map, credibility signals, keyword radar, read-later list, and anti-filter-bubble recommendations
- **Reader mode** — Full article content extraction with dark/light themes, reading time estimate, and rich typography
- **In-app source browsing** — Browse original article in an iframe, or take a screenshot via Cloudflare Browser Rendering
- **TTS speed control** — Adjustable playback speed (0.5x–1.5x) for voice narration
- **Push notifications** — Subscribe to browser push notifications for breaking news
- **User system** — Registration, login, JWT authentication
- **Favorites & history** — Bookmark articles, track read history
- **Read later & radar** — Save articles for later and monitor custom keywords for fresh matches
- **Comments** — Real-time WebSocket comments on news articles
- **Source manager** — Admin panel to add, edit, delete, and reorder RSS sources
- **Email digest** — Subscribe to daily news summaries
- **Auto-update** — Cron triggers fetch new articles every hour
- **News voice playback** — Browser-native SpeechSynthesis, free, no API calls
- **AI classification** — LLaMA 3.1 8B classifies news by content, not source defaults
- **Bot protection** — Turnstile verification on login/register
- **Edge caching** — News list cached on CF edge (60s) + Cache Rules (hashed assets 1y, image proxy 7d)
- **Image proxy with R2 cache** — External images proxied through CF edge and cached in R2 (10GB free, 0 egress)
- **AI illustration persistence** — AI-generated illustrations stored in R2, never broken by expiring temp URLs
- **Pixabay stock illustration** — Image-less news cards auto-filled with relevant Pixabay illustrations (downloaded to R2, hotlink-compliant). Cards show a 「配图」badge so auto-generated images are clearly distinguished from original source images
- **Global service rankings** — Cloudflare Radar internet-service rankings supplement the trending panel
- **Usage analytics** — Workers Analytics Engine records search hot-words and per-provider AI call stats
- **Durable backfill** — Admin backfill jobs run as Cloudflare Workflows (auto-retry, survives request lifetime)
- **Smart Placement** — Worker auto-places near upstream AI/RSS endpoints for lower latency
- **Email unsubscribe** — Reply "退订" to digest@ and the subscription turns off (Email Routing inbound)
- **Privacy-friendly analytics** — Cloudflare Web Analytics beacon (no cookies)
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
| Summaries | OpenRouter, NVIDIA, Mango, Zen (1M-context large-batch) APIs |
| Vector | Vectorize for semantic dedup |
| Object Storage | R2 (image proxy cache + AI illustrations) |
| Durable Tasks | Workflows (backfill jobs) |
| Analytics | Analytics Engine (search/AI stats) + Web Analytics (traffic) |
| Global Trends | Radar API (internet service rankings) |
| Email Inbound | Email Routing (digest unsubscribe) |
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
ZEN_API_KEY=your-zen-api-key            # from opencode.ai/zen (aggregated API: Claude/GPT/Gemini/DeepSeek/Kimi + 8 free models)
TURNSTILE_SECRET=your-turnstile-secret    # from dashboard
TURNSTILE_SITE_KEY=0x4AAAA...            # from dashboard
PIXABAY_API_KEY=your-pixabay-key          # from pixabay.com/api/docs (free)
```

### Step 8: Add Custom Domain to Workers

After first deploy, add your domain:

1. Go to Cloudflare Dashboard → **Workers & Pages**
2. Click your worker (`cf-news-worker`)
3. Go to **Settings** → **Triggers** → **Custom Domains**
4. Add your domain (e.g., `news.yourdomain.com`)

### Step 9: R2 Bucket (image cache + AI illustrations)

`wrangler.toml` already binds bucket `cf-news-images` to `R2_IMAGES`. Create it once:

```bash
docker run --rm --env-file cf-news-worker/.env \
  -v $(pwd)/cf-news-worker:/app -v /app/node_modules --network=host \
  cf-news-worker npx wrangler r2 bucket create cf-news-images
```

### Step 10: Email Routing Inbound (digest unsubscribe)

1. Dashboard → **Compute > Email Service > Email Routing** → enable for your zone
2. Add a routing rule: pattern `digest@yourdomain.com` → action **Send to a Worker** → `cf-news-worker`
3. Replying "退订" (or unsubscribe/stop) to digest@ disables the sender's daily digest

### Step 11: Radar API Token (global trend rankings)

The `/api/news/trending/radar` endpoint needs an API token with `Account > Radar > Read`:

```bash
grep "^CLOUDFLARE_API_TOKEN=" cf-news-worker/.env | cut -d= -f2- | \
  docker run --rm -i --env-file cf-news-worker/.env \
  -v $(pwd)/cf-news-worker:/app -v /app/node_modules --network=host \
  cf-news-worker npx wrangler secret put RADAR_API_TOKEN
```

### Step 12: Web Analytics (traffic)

1. Dashboard → **Analytics > Web Analytics** → create a site for your domain
2. Copy the beacon token (e.g. `0x...`) and replace `VITE_WEB_ANALYTICS_TOKEN` in `cf-news-frontend/index.html`

### Step 13 (optional): Zero Trust Access (admin protection)

Protect the admin UI behind Cloudflare Access (free up to 50 users):

1. Dashboard → **Zero Trust** → **Access > Applications** → Add an application
2. Domain: `news.yourdomain.com`; Path: `/api/admin/*` and `/admin`
3. Policy: Allow your email / any valid session → Save

### Step 14 (optional): Pixabay API key (image-less news auto-illustration)

Image-less news cards can be auto-filled with relevant Pixabay illustrations (free, 100 req/min). Register at [pixabay.com](https://pixabay.com/api/docs/) and push the key:

```bash
grep "^PIXABAY_API_KEY=" cf-news-worker/.env | cut -d= -f2- | \
  docker run --rm -i --env-file cf-news-worker/.env \
  -v $(pwd)/cf-news-worker:/app -v /app/node_modules --network=host \
  cf-news-worker npx wrangler secret put PIXABAY_API_KEY
```

Then trigger a batch fill for recent image-less news (admin JWT required):

```bash
curl -X POST -H "Authorization: Bearer <admin-token>" \
  https://news.yourdomain.com/api/illustrate-stock -d '{"limit":20}'
```

Illustrations are downloaded into R2 (self-hosted, Pixabay hotlink-compliant) and served via the existing `/api/image` proxy. Without the key, the endpoint returns 502 and cards keep the text-only layout.

Cache Rules for hashed assets (1 year) and the image proxy (7 days) are configured via the ruleset API — see `deploy.sh` output or create them in Dashboard → **Rules > Cache Rules**.

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
| `ZEN_API_KEY` | Zen API key (opencode.ai/zen — aggregated AI provider) |
| `TURNSTILE_SECRET` | Turnstile secret key (bot protection) |
| `TURNSTILE_SITE_KEY` | Turnstile site key |
| `PIXABAY_API_KEY` | Pixabay free image API key (image-less news auto-illustration) |

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
| GET | `/api/news/trending/overview?hours=24` | AI summary of today's news landscape (KV cached 30 min) |
| GET | `/api/news/trending/theme-perspectives?keyword=X&hours=24` | Multi-perspective analysis for a trending theme |
| GET | `/api/news/trending/themes?hours=24` | Trending topic clusters with representative articles |
| GET | `/api/news/trending/topics?hours=24` | Trending topics time series |
| GET | `/api/news/trending/categories?hours=24` | Category distribution of trending content |
| GET | `/api/news/trending/compare?keywords=a,b,c&hours=48` | Multi-keyword time series comparison |
| GET | `/api/news/trending/hourly?hours=24` | Hourly source & category distribution |
| GET | `/api/news/trending/radar` | Global internet-service rankings from Cloudflare Radar |
| GET | `/api/news/trending/overview?hours=24` | AI "today's news landscape" summary (KV-cached 30 min) |
| GET | `/api/news/trending/theme-perspectives?keyword=X&hours=24` | AI multi-perspective analysis of a trending theme |
| GET | `/api/news/timeline?keyword=AI&hours=168` | Event timeline for a keyword or recent news |
| GET | `/api/news/map?hours=48` | Region distribution inferred from recent news |
| GET | `/api/news/fresh-view?exclude=tech,ai` | Anti-filter-bubble recommendations |
| GET | `/api/news/:id/credibility` | Source diversity and corroboration signals |
| GET | `/api/news/:id/perspectives` | AI-generated viewpoint spectrum across related reports |
| GET | `/api/news/:id/entities` | Structured entities extracted from the article |
| GET | `/api/news/:id/content` | Fetch full article content |
| GET | `/api/comments/:newsId` | Get comments for a news item |
| POST | `/api/auth/register` | Register |
| POST | `/api/auth/login` | Login |
| GET | `/api/ai/digest` | Get today's daily digest |
| GET | `/api/ai/digest?date=YYYY-MM-DD` | Get digest for a specific date |
| GET | `/api/ai/digest/dates` | List available digest dates |
| GET | `/api/ai/related/:id` | Get related articles |
| GET | `/api/health` | Health check |
| GET | `/api/health/feed` | Feed freshness check — `ok:false` when no news for 6h or fetch cron heartbeat missing for 2h (for UptimeRobot / external monitors) |
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
| GET | `/api/user/read-later` | List read-later articles |
| POST | `/api/user/read-later/:id` | Add an article to read later |
| DELETE | `/api/user/read-later/:id` | Remove an article from read later |
| GET | `/api/user/radar?hours=48` | List radar keywords and matching articles |
| POST | `/api/user/radar` | Add a radar keyword |
| DELETE | `/api/user/radar/:keyword` | Remove a radar keyword |
| POST | `/api/ai/ask` | Ask a question about news (supports streaming) |
| POST | `/api/ai/digest/generate` | Force regenerate digest (admin only) |
| POST | `/api/ai/trending/insight` | AI-generated insight for trending keyword |
| POST | `/api/user/push/subscribe` | Subscribe to push notifications |
| DELETE | `/api/user/push/unsubscribe` | Unsubscribe from push notifications |
| POST | `/api/illustrate-stock/:newsId` | Auto-fill a single image-less news item with a Pixabay illustration |
| POST | `/api/illustrate-stock` | Batch-fill image-less news (default 10, max 20; body `{limit}`) |

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
| POST | `/api/admin/backfill-vectors` | Backfill semantic dedup vectors for old items (background, 500/batch) |
| POST | `/api/admin/backfill-entities` | Backfill structured entity extraction for items missing entities (background, 50/batch) |

## Adding RSS Sources

Edit `cf-news-worker/src/db/schema.sql` or insert directly:

```sql
INSERT INTO news_sources (name, url, feed_url, category, language)
VALUES ('Source Name', 'https://example.com', 'https://example.com/rss', 'tech', 'en');
```

## License

MIT

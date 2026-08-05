# cf-news-frontend

Frontend for [CF News](../README.md) — a daily news aggregation platform running on Cloudflare Workers. [中文文档](README_zh.md)

## Overview

Single-page application built with React 19 + Vite 8 + Tailwind 4 + TypeScript 6. Compiled to static assets, copied into `cf-news-worker/public/`, and served by the Hono API worker as Cloudflare [assets]. The API is reached via same-origin relative `/api/*` paths — there is no CORS or separate API host.

## Tech Stack

| Layer | Technology |
|-------|------------|
| UI | React 19.2, TypeScript 6, Tailwind 4 (CSS-first via `@theme` in `src/index.css`) |
| Build | Vite 8 (`@vitejs/plugin-react` + `@tailwindcss/vite`) |
| HTTP | axios (interceptor injects `Authorization: Bearer <token>` from `localStorage['token']`) |
| Utilities | dayjs, browser SpeechSynthesis (TTS), IndexedDB (clipboard image cache) |
| PWA | `public/sw.js` + `public/manifest.json`, registered in `src/main.tsx` |

## Project Structure

```
src/
├── components/            # 18 root components (Header, NewsCard, NewsDetailModal, ...)
│   ├── clipboard/         # Clipboard subsystem (text/image/file sharing, device security)
│   └── trending/          # Trending panel sub-tabs (hot keywords, rising topics, themes, charts)
├── pages/Home.tsx         # The only page — single orchestrator, holds all app state
├── hooks/useClipboardWS.ts# The only custom hook — WebSocket clipboard sync + file transfer
├── api/client.ts          # Axios wrapper (named endpoint fns + default `api` export)
├── utils/                 # newsFormat.ts (sanitize), clipboard.ts, image.ts (compress)
└── types/index.ts         # Frontend type definitions
```

Per-file inventory with roles: see [AGENTS.md](AGENTS.md).

## Key Architecture Facts

- **No router library.** "Routing" is boolean panel state in `Home.tsx`; share URLs use `history.replaceState('/share/:id')`; clipboard handoff uses the `#clip=` hash.
- **No state management library.** React state + props drilling only.
- **Lazy loading** (`React.lazy` + `Suspense`): DailyDigest, ClipboardShare, NewsQA, ExplorePanel.
- **Chinese UI text** throughout.
- **Raw `fetch()`** (not axios) for streaming / blob / admin-trigger endpoints (`askQuestionStream`, digest generate, user export).
- **XSS-safe HTML**: `dangerouslySetInnerHTML` only behind `sanitizeHtml` in `utils/newsFormat.ts` (also rewrites external images through the `/api/image?url=` proxy).

## Development

All npm operations run inside Docker — no Node.js on the host (repo rule):

```bash
docker run --rm \
  -v $(pwd):/app -v /app/node_modules -w /app --network=host \
  node:22-slim sh -c '
    npm config set registry https://registry.npmmirror.com
    npm install
    npm run dev
  '
```

Vite dev server: **http://localhost:5173**. There is no dev proxy — `/api` requests need a worker instance on the same host (e.g. `npx wrangler dev` in `cf-news-worker`, or a deployed site).

## Build & Deploy

Run `./deploy.sh` at the repo root. It builds the frontend in Docker (`npm install && npm run build`), copies `dist/` into `cf-news-worker/public/`, applies D1 migrations, and deploys with wrangler.

Build metadata is injected as `VITE_BUILD_TIME` / `VITE_BUILD_PLATFORM` / `VITE_BUILD_VERSION` / `VITE_BUILD_COMMIT` and displayed in `src/components/Footer.tsx`.

## Conventions & Testing

- Inline Tailwind classes throughout; design tokens in `src/index.css` (`@theme` + `@utility`).
- Two mega-files to be careful with: `NewsDetailModal.tsx` (1121 lines) and `useClipboardWS.ts` (686 lines) — keep new code modular.
- Frontend tests not yet configured. When adding: **vitest + React Testing Library**, covering user interactions, render states, and API/WS handling.

## License

MIT

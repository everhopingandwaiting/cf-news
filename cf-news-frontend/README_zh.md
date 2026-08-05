# cf-news-frontend

[CF News](../README_zh.md) 的前端 —— 运行在 Cloudflare Workers 上的每日新闻聚合平台。[English](README.md)

## 概述

基于 React 19 + Vite 8 + Tailwind 4 + TypeScript 6 的单页应用。构建产物拷贝到 `cf-news-worker/public/`，由 Hono API Worker 作为 Cloudflare [assets] 静态资源提供服务。API 通过同源相对路径 `/api/*` 访问 —— 无 CORS、无独立 API 域名。

## 技术栈

| 层 | 技术 |
|----|------|
| UI | React 19.2、TypeScript 6、Tailwind 4（CSS-first，令牌定义在 `src/index.css` 的 `@theme`） |
| 构建 | Vite 8（`@vitejs/plugin-react` + `@tailwindcss/vite`） |
| HTTP | axios（拦截器自动注入 `Authorization: Bearer <token>`，取自 `localStorage['token']`） |
| 工具 | dayjs、浏览器 SpeechSynthesis（TTS 朗读）、IndexedDB（剪贴板图片缓存） |
| PWA | `public/sw.js` + `public/manifest.json`，在 `src/main.tsx` 注册 |

## 目录结构

```
src/
├── components/            # 18 个根组件（Header、NewsCard、NewsDetailModal、...）
│   ├── clipboard/         # 剪贴板子系统（文本/图片/文件分享、设备安全）
│   └── trending/          # 趋势面板子页签（热门关键词、上升话题、主题、图表）
├── pages/Home.tsx         # 唯一页面 —— 单页编排器，持有全部应用状态
├── hooks/useClipboardWS.ts# 唯一自定义 Hook —— WebSocket 剪贴板同步 + 文件传输
├── api/client.ts          # Axios 封装（命名端点函数 + 默认 `api` 导出）
├── utils/                 # newsFormat.ts（sanitize）、clipboard.ts、image.ts（压缩）
└── types/index.ts         # 前端类型定义
```

逐文件清单与职责：见 [AGENTS.md](AGENTS.md)。

## 核心架构要点

- **无路由库。** "路由"是 `Home.tsx` 中的布尔面板状态；分享链接用 `history.replaceState('/share/:id')`；剪贴板交接用 `#clip=` hash。
- **无状态管理库。** 仅用 React state + props 逐层传递。
- **懒加载**（`React.lazy` + `Suspense`）：DailyDigest、ClipboardShare、NewsQA、ExplorePanel。
- **界面文案全中文。**
- **流式/二进制/管理类端点用原生 `fetch()`**（而非 axios）：`askQuestionStream`、digest 生成、用户数据导出。
- **XSS 安全**：`dangerouslySetInnerHTML` 只允许出现在 `utils/newsFormat.ts` 的 `sanitizeHtml` 之后（同时把外链图片改写为经 `/api/image?url=` 代理加载）。

## 开发

所有 npm 操作都在 Docker 内执行 —— 主机不安装 Node.js（仓库规则）：

```bash
docker run --rm \
  -v $(pwd):/app -v /app/node_modules -w /app --network=host \
  node:22-slim sh -c '
    npm config set registry https://registry.npmmirror.com
    npm install
    npm run dev
  '
```

Vite 开发服务器：**http://localhost:5173**。没有 dev proxy —— `/api` 请求需要一个同主机可访问的 Worker 实例（如在 `cf-news-worker` 下 `npx wrangler dev`，或已部署的线上站点）。

## 构建与部署

在仓库根目录执行 `./deploy.sh`。流程：Docker 内构建前端（`npm install && npm run build`）→ 拷贝 `dist/` 到 `cf-news-worker/public/` → 应用 D1 迁移 → wrangler 部署。

构建元信息以 `VITE_BUILD_TIME` / `VITE_BUILD_PLATFORM` / `VITE_BUILD_VERSION` / `VITE_BUILD_COMMIT` 注入，展示在 `src/components/Footer.tsx`。

## 规范与测试

- 全部使用内联 Tailwind class；设计令牌在 `src/index.css`（`@theme` + `@utility`）。
- 两个大文件需小心改动：`NewsDetailModal.tsx`（1121 行）和 `useClipboardWS.ts`（686 行）—— 新代码保持模块化。
- 前端测试尚未配置。新增时建议：**vitest + React Testing Library**，覆盖用户交互、渲染状态、API/WS 处理。

## 许可证

MIT

#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
FRONTEND_DIR="$ROOT/cf-news-frontend"
WORKER_DIR="$ROOT/cf-news-worker"

# 0. Generate wrangler.toml from .example + .env
echo "==> Generating wrangler.toml..."
set -a
source "$WORKER_DIR/.env"
set +a
envsubst < "$WORKER_DIR/wrangler.toml.example" > "$WORKER_DIR/wrangler.toml"

# 1. Build frontend
echo "==> Building frontend..."
cd "$FRONTEND_DIR"
npm run build 2>&1 | tail -3

# 2. Copy dist to worker/public (Cloudflare [assets] handles serving)
echo "==> Copying assets..."
rm -rf "$WORKER_DIR/public/"*
cp -r dist/* "$WORKER_DIR/public/"

# 3. Remove old static.ts (no longer used)
rm -f "$WORKER_DIR/src/static.ts"

# 4. Docker build + deploy
echo "==> Building Docker image..."
cd "$WORKER_DIR"
docker build --no-cache --network=host -t cf-news-worker . 2>&1 | tail -1

echo "==> Deploying to Cloudflare..."
docker run --rm --env-file .env cf-news-worker npx wrangler deploy 2>&1 | tail -8

echo "==> Done!"

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
# D1 用 name 绑定，不需要 database_id，过滤掉避免 envsubst 警告
unset D1_DATABASE_ID
envsubst < "$WORKER_DIR/wrangler.toml.example" > "$WORKER_DIR/wrangler.toml"

# 1. Build frontend
echo "==> Building frontend..."
cd "$FRONTEND_DIR"
export VITE_BUILD_TIME="${VITE_BUILD_TIME:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}"
export VITE_BUILD_PLATFORM="${VITE_BUILD_PLATFORM:-Local}"
export VITE_BUILD_VERSION="${VITE_BUILD_VERSION:-$(git describe --tags --abbrev=0 2>/dev/null || echo "")}"
export VITE_BUILD_COMMIT="${VITE_BUILD_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo "")}"
npm run build 2>&1 | tail -3

# 2. Copy dist to worker/public (Cloudflare [assets] handles serving)
echo "==> Copying assets..."
rm -rf "$WORKER_DIR/public/"*
cp -r dist/* "$WORKER_DIR/public/"

# 3. Remove old static.ts (no longer used)
rm -f "$WORKER_DIR/src/static.ts"

# 4. Docker build
echo "==> Building Docker image..."
cd "$WORKER_DIR"
docker build --no-cache --network=host -t cf-news-worker . 2>&1 | tail -1

# 5. Deploy first (new wrangler.toml removes secrets from [vars])
echo "==> Deploying to Cloudflare..."
docker run --rm --env-file .env cf-news-worker npx wrangler deploy 2>&1 | tail -8

# 6. Push secrets to Cloudflare (idempotent, updates if changed)
echo "==> Updating secrets..."
for key in JWT_SECRET OPENROUTER_API_KEY NVIDIA_API_KEY MANGO_API_KEY; do
  value=$(grep "^${key}=" .env | cut -d= -f2-)
  if [ -n "$value" ]; then
    echo "$value" | docker run --rm -i --env-file .env cf-news-worker npx wrangler secret put "$key" 2>&1 | tail -1
  fi
done

echo "==> Done!"

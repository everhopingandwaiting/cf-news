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

# Ensure base image exists (build once, only rebuild when deps change)
if ! docker image inspect cf-news-worker &>/dev/null; then
  echo "==> Building base image (first time)..."
  docker build --network=host -t cf-news-worker "$WORKER_DIR"
fi

# 1. Build frontend (in Docker — no host npm/node needed)
echo "==> Building frontend..."
export VITE_BUILD_TIME="${VITE_BUILD_TIME:-$(date -u +"%Y-%m-%dT%H:%M:%SZ")}"
export VITE_BUILD_PLATFORM="${VITE_BUILD_PLATFORM:-Local}"
export VITE_BUILD_VERSION="${VITE_BUILD_VERSION:-$(git describe --tags --abbrev=0 2>/dev/null || echo "")}"
export VITE_BUILD_COMMIT="${VITE_BUILD_COMMIT:-$(git rev-parse --short HEAD 2>/dev/null || echo "")}"

docker run --rm \
  -v "$FRONTEND_DIR:/app" \
  -v /app/node_modules \
  -w /app \
  -e VITE_BUILD_TIME="$VITE_BUILD_TIME" \
  -e VITE_BUILD_PLATFORM="$VITE_BUILD_PLATFORM" \
  -e VITE_BUILD_VERSION="$VITE_BUILD_VERSION" \
  -e VITE_BUILD_COMMIT="$VITE_BUILD_COMMIT" \
  --network=host \
  node:22-slim sh -c '
    npm config set registry https://registry.npmmirror.com
    npm install
    npm run build
  ' 2>&1 | tail -3

# 2. Copy dist to worker/public (Cloudflare [assets] handles serving)
echo "==> Copying assets..."
rm -rf "$WORKER_DIR/public/"*
cp -r "$FRONTEND_DIR/dist/"* "$WORKER_DIR/public/"

# 3. Remove old static.ts (no longer used)
rm -f "$WORKER_DIR/src/static.ts"

# 4. Deploy to Cloudflare (in Docker — source mounted, no rebuild)
echo "==> Deploying to Cloudflare..."
docker run --rm --env-file "$WORKER_DIR/.env" \
  -v "$WORKER_DIR:/app" \
  -v /app/node_modules \
  --network=host \
  cf-news-worker npx wrangler deploy 2>&1 | tail -8

# 5. Push secrets to Cloudflare (idempotent, updates if changed)
echo "==> Updating secrets..."
for key in JWT_SECRET OPENROUTER_API_KEY NVIDIA_API_KEY MANGO_API_KEY GROQ_API_KEY TURNSTILE_SECRET; do
  value=$(grep "^${key}=" "$WORKER_DIR/.env" | cut -d= -f2-)
  if [ -n "$value" ]; then
    echo "$value" | docker run --rm -i --env-file "$WORKER_DIR/.env" \
      -v "$WORKER_DIR:/app" \
      -v /app/node_modules \
      --network=host \
      cf-news-worker npx wrangler secret put "$key" 2>&1 | tail -1
  fi
done

echo "==> Done!"

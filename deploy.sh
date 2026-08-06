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

# 2. Apply pending D1 migrations before deploying code that may depend on new schema
echo "==> Applying D1 migrations..."
"$WORKER_DIR/scripts/migrate.sh"

# 3. Copy dist to worker/public (Cloudflare [assets] handles serving)
echo "==> Copying assets..."
rm -rf "$WORKER_DIR/public/"*
cp -r "$FRONTEND_DIR/dist/"* "$WORKER_DIR/public/"

# 4. Remove old static.ts (no longer used)
rm -f "$WORKER_DIR/src/static.ts"

# 5. Deploy to Cloudflare (in Docker — source mounted, no rebuild)
echo "==> Deploying to Cloudflare..."
docker run --rm --env-file "$WORKER_DIR/.env" \
  -v "$WORKER_DIR:/app" \
  -v /app/node_modules \
  --network=host \
  cf-news-worker npx wrangler deploy 2>&1

# 6. Purge CF edge cache for updated frontend assets
echo "==> Purging edge cache..."
ZONE_ID="${ZONE_ID:-}"
if [ -n "$ZONE_ID" ]; then
  # Try API token first, fall back to wrangler (uses CLOUDFLARE_API_TOKEN)
  CF_API_TOKEN="${CF_API_TOKEN:-${CLOUDFLARE_API_TOKEN:-}}"
  if [ -n "$CF_API_TOKEN" ]; then
    curl -sf -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/purge_cache" \
      -H "Authorization: Bearer $CF_API_TOKEN" \
      -H "Content-Type: application/json" \
      --data '{"purge_everything":true}' > /dev/null && echo "  Cache purged via API" || echo "  API purge failed (token may lack Zone > Cache > Purge permission)"
  else
    echo "  No API token available, skipping cache purge"
  fi
else
  echo "  ZONE_ID not set, skipping cache purge"
fi

# 7. Push secrets to Cloudflare (only if changed)
echo "==> Updating secrets..."
SECRETS_CACHE="$WORKER_DIR/.secrets-cache"
mkdir -p "$(dirname "$SECRETS_CACHE")"
touch "$SECRETS_CACHE"
for key in JWT_SECRET OPENROUTER_API_KEY NVIDIA_API_KEY MANGO_API_KEY GROQ_API_KEY FREEMODEL_API_KEY AGNES_API_KEY TURNSTILE_SECRET RADAR_API_TOKEN; do
  value=$(grep "^${key}=" "$WORKER_DIR/.env" 2>/dev/null | cut -d= -f2- || true)
  if [ -z "$value" ]; then continue; fi
  last_hash=$(grep "^${key}=" "$SECRETS_CACHE" 2>/dev/null | cut -d= -f2- || true)
  current_hash=$(echo -n "$value" | md5sum | cut -d' ' -f1)
  if [ "$last_hash" = "$current_hash" ]; then
    echo "  $key unchanged, skipping"
  else
    echo "$value" | docker run --rm -i --env-file "$WORKER_DIR/.env" \
      -v "$WORKER_DIR:/app" \
      -v /app/node_modules \
      --network=host \
      cf-news-worker npx wrangler secret put "$key" 2>&1 | tail -1
    # Update cache
    if grep -q "^${key}=" "$SECRETS_CACHE" 2>/dev/null; then
      sed -i "s/^${key}=.*/${key}=${current_hash}/" "$SECRETS_CACHE"
    else
      echo "${key}=${current_hash}" >> "$SECRETS_CACHE"
    fi
  fi
done

echo "==> Done!"

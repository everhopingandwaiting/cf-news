#!/usr/bin/env bash
# Apply D1 database migrations incrementally.
#
# Usage:
#   ./scripts/migrate.sh              # apply all pending migrations
#   ./scripts/migrate.sh --check      # show pending migrations only
#   ./scripts/migrate.sh --version    # show current schema version
#
# Convention:
#   migrations/001-initial.sql  = full initial schema (schema.sql)
#   migrations/002-*.sql        = incremental changes
#   migrations/003-*.sql        = etc.
#
# Version tracking: app_config key 'schema_version' in D1.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/migrations"

DOCKER_ENV_ARGS=()
if [ -f "$ROOT/.env" ]; then
  DOCKER_ENV_ARGS+=(--env-file "$ROOT/.env")
fi
if [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  DOCKER_ENV_ARGS+=(-e "CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN")
fi
if [ -n "${D1_DATABASE_ID:-}" ]; then
  DOCKER_ENV_ARGS+=(-e "D1_DATABASE_ID=$D1_DATABASE_ID")
fi

# Resolve current version from D1
current_version() {
  local output
  local version
  if ! output=$(docker run --rm "${DOCKER_ENV_ARGS[@]}" \
    -v "$ROOT:/app" -v /app/node_modules --network=host \
    cf-news-worker npx wrangler d1 execute news-db --remote --json \
    --command="SELECT value FROM app_config WHERE key='schema_version'" \
    2>/dev/null); then
    echo "0"
    return
  fi

  version=$(printf '%s\n' "$output" | sed -n 's/.*"value"[[:space:]]*:[[:space:]]*"\([0-9][0-9]*\)".*/\1/p' | head -n 1)
  if [ -n "$version" ]; then
    echo "$version"
  else
    echo "0"
  fi
}

list_migrations() {
  find "$MIGRATIONS_DIR" -name '*.sql' | sort
}

column_exists() {
  local table="$1"
  local column="$2"
  local output

  output=$(docker run --rm "${DOCKER_ENV_ARGS[@]}" \
    -v "$ROOT:/app" -v /app/node_modules --network=host \
    cf-news-worker npx wrangler d1 execute news-db --remote --json \
    --command="PRAGMA table_info($table)" 2>/dev/null || true)

  printf '%s\n' "$output" | grep -q "\"name\"[[:space:]]*:[[:space:]]*\"$column\""
}

mark_version() {
  local version="$1"
  docker run --rm "${DOCKER_ENV_ARGS[@]}" \
    -v "$ROOT:/app" -v /app/node_modules --network=host \
    cf-news-worker npx wrangler d1 execute news-db --remote \
    --command="INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '$version')" \
    >/dev/null
}

ai_call_log_details_exist() {
  column_exists "ai_call_log" "model" &&
  column_exists "ai_call_log" "news_title" &&
  column_exists "ai_call_log" "response_preview" &&
  column_exists "ai_call_log" "duration_ms" &&
  column_exists "ai_call_log" "error"
}

apply_migration() {
  local file="$1"
  local name="$(basename "$file")"
  echo "==> Applying $name..."
  if [ "$name" = "004-add-news-source-error-count.sql" ] && column_exists "news_sources" "error_count"; then
    mark_version "4"
    echo "  news_sources.error_count already exists; marked schema_version=4"
    echo "  ✔ $name done"
    return
  fi
  if [ "$name" = "005-add-ai-call-log-details.sql" ] && ai_call_log_details_exist; then
    mark_version "5"
    echo "  ai_call_log detail columns already exist; marked schema_version=5"
    echo "  ✔ $name done"
    return
  fi
  docker run --rm "${DOCKER_ENV_ARGS[@]}" \
    -v "$ROOT:/app" -v /app/node_modules --network=host \
    cf-news-worker npx wrangler d1 execute news-db --remote --file="/app/migrations/$name" 2>&1 | tail -3
  echo "  ✔ $name done"
}

case "${1:-}" in
  --check)
    current=$(current_version)
    echo "Current schema version: $current"
    for f in $(list_migrations); do
      ver=$(basename "$f" | cut -d- -f1 | sed 's/^0*//')
      if [ "$ver" -gt "$current" ]; then
        echo "  Pending: $(basename "$f")"
      fi
    done
    ;;
  --version)
    current_version
    ;;
  *)
    current=$(current_version)
    echo "Current schema version: $current"
    for f in $(list_migrations); do
      ver=$(basename "$f" | cut -d- -f1 | sed 's/^0*//')
      if [ "$ver" -gt "$current" ]; then
        apply_migration "$f"
      fi
    done
    echo "==> Migration complete"
    ;;
esac

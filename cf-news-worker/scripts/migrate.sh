#!/usr/bin/env bash
# Apply D1 database migrations incrementally (multi-database aware).
#
# Usage:
#   ./scripts/migrate.sh                     # apply pending migrations to ALL databases
#                                            #   (news-db → migrations/, cf-news-archive → migrations-archive/)
#   ./scripts/migrate.sh --database news-db  # single target only
#   ./scripts/migrate.sh --database cf-news-archive
#   ./scripts/migrate.sh --check             # show pending migrations only (all targets)
#   ./scripts/migrate.sh --version           # show current schema versions
#
# Convention:
#   migrations/001-initial.sql         = full initial schema (schema.sql)     [news-db]
#   migrations/002-*.sql .. NNN-*.sql  = incremental changes                  [news-db]
#   migrations-archive/001-init.sql    = archive-DB content-domain subset     [cf-news-archive]
#
# Version tracking: app_config key 'schema_version' per database.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/migrations"
ARCHIVE_MIGRATIONS_DIR="$ROOT/migrations-archive"

# 默认双库：主库 + 归档库（冷热分库）。--database 缩到单库。
TARGETS=("news-db" "cf-news-archive")

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

mig_dir_for() {
  if [ "$1" = "cf-news-archive" ]; then echo "$ARCHIVE_MIGRATIONS_DIR"; else echo "$MIGRATIONS_DIR"; fi
}

# Resolve current version from D1 (per database; missing table/DB → 0)
current_version() {
  local db="$1"
  local output
  local version
  if ! output=$(docker run --rm "${DOCKER_ENV_ARGS[@]}" \
    -v "$ROOT:/app" -v /app/node_modules --network=host \
    cf-news-worker npx wrangler d1 execute "$db" --remote --json \
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
  find "$1" -name '*.sql' | sort
}

column_exists() {
  local db="$1"
  local table="$2"
  local column="$3"
  local output

  output=$(docker run --rm "${DOCKER_ENV_ARGS[@]}" \
    -v "$ROOT:/app" -v /app/node_modules --network=host \
    cf-news-worker npx wrangler d1 execute "$db" --remote --json \
    --command="PRAGMA table_info($table)" 2>/dev/null || true)

  printf '%s\n' "$output" | grep -q "\"name\"[[:space:]]*:[[:space:]]*\"$column\""
}

mark_version() {
  local db="$1"
  local version="$2"
  docker run --rm "${DOCKER_ENV_ARGS[@]}" \
    -v "$ROOT:/app" -v /app/node_modules --network=host \
    cf-news-worker npx wrangler d1 execute "$db" --remote \
    --command="INSERT OR REPLACE INTO app_config (key, value) VALUES ('schema_version', '$version')" \
    >/dev/null
}

ai_call_log_details_exist() {
  local db="$1"
  column_exists "$db" "ai_call_log" "model" &&
  column_exists "$db" "ai_call_log" "news_title" &&
  column_exists "$db" "ai_call_log" "response_preview" &&
  column_exists "$db" "ai_call_log" "duration_ms" &&
  column_exists "$db" "ai_call_log" "error"
}

apply_migration() {
  local db="$1"
  local mig_dir="$2"
  local file="$3"
  local name="$(basename "$file")"
  local container_dir="$(basename "$mig_dir")"
  echo "==> [$db] Applying $name..."
  # 主库历史迁移的幂等保护（归档库目录里没有这些文件，天然不会触发）
  if [ "$db" = "news-db" ] && [ "$name" = "004-add-news-source-error-count.sql" ] && column_exists "news-db" "news_sources" "error_count"; then
    mark_version "news-db" "4"
    echo "  news_sources.error_count already exists; marked schema_version=4"
    echo "  ✔ $name done"
    return
  fi
  if [ "$db" = "news-db" ] && [ "$name" = "005-add-ai-call-log-details.sql" ] && ai_call_log_details_exist "news-db"; then
    mark_version "news-db" "5"
    echo "  ai_call_log detail columns already exist; marked schema_version=5"
    echo "  ✔ $name done"
    return
  fi
  docker run --rm "${DOCKER_ENV_ARGS[@]}" \
    -v "$ROOT:/app" -v /app/node_modules --network=host \
    cf-news-worker npx wrangler d1 execute "$db" --remote --file="/app/$container_dir/$name" 2>&1 | tail -3
  echo "  ✔ $name done"
}

# 解析 --database（位置任意，其余参数透传给主逻辑）
POSITIONAL=()
while [ $# -gt 0 ]; do
  case "$1" in
    --database)
      TARGETS=("$2"); shift 2 ;;
    --database=*)
      TARGETS=("${1#*=}"); shift ;;
    *)
      POSITIONAL+=("$1"); shift ;;
  esac
done
set -- "${POSITIONAL[@]+"${POSITIONAL[@]}"}"

for db in "${TARGETS[@]}"; do
  mig_dir="$(mig_dir_for "$db")"
  if [ ! -d "$mig_dir" ]; then
    echo "!! migrations dir missing for $db: $mig_dir" >&2
    exit 1
  fi
done

case "${1:-}" in
  --check)
    for db in "${TARGETS[@]}"; do
      mig_dir="$(mig_dir_for "$db")"
      current=$(current_version "$db")
      echo "[$db] Current schema version: $current"
      for f in $(list_migrations "$mig_dir"); do
        ver=$(basename "$f" | cut -d- -f1 | sed 's/^0*//')
        if [ "$ver" -gt "$current" ]; then
          echo "  Pending: $(basename "$f")"
        fi
      done
    done
    ;;
  --version)
    for db in "${TARGETS[@]}"; do
      echo "[$db] $(current_version "$db")"
    done
    ;;
  *)
    for db in "${TARGETS[@]}"; do
      mig_dir="$(mig_dir_for "$db")"
      current=$(current_version "$db")
      echo "[$db] Current schema version: $current"
      for f in $(list_migrations "$mig_dir"); do
        ver=$(basename "$f" | cut -d- -f1 | sed 's/^0*//')
        if [ "$ver" -gt "$current" ]; then
          apply_migration "$db" "$mig_dir" "$f"
        fi
      done
    done
    echo "==> Migration complete"
    ;;
esac

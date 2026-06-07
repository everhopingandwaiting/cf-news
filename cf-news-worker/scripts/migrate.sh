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

# Resolve current version from D1
current_version() {
  docker run --rm --env-file "$ROOT/.env" \
    -v "$ROOT:/app" -v /app/node_modules --network=host \
    cf-news-worker npx wrangler d1 execute news-db --remote --json \
    --command="SELECT value FROM app_config WHERE key='schema_version'" \
    2>/dev/null | python3 -c "
import json,sys
data = json.load(sys.stdin)
rows = data[0]['results']
if rows and rows[0]:
    print(rows[0]['value'])
else:
    print('0')
" 2>/dev/null || echo "0"
}

list_migrations() {
  find "$MIGRATIONS_DIR" -name '*.sql' | sort
}

apply_migration() {
  local file="$1"
  local name="$(basename "$file")"
  echo "==> Applying $name..."
  docker run --rm --env-file "$ROOT/.env" \
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

#!/usr/bin/env bash
# sync-github-secrets.sh — Push secrets from .env to GitHub Actions repository secrets.
# Requires: gh CLI (authenticated), cf-news-worker/.env
#
# Usage:
#   gh auth login               # first time
#   ./scripts/sync-github-secrets.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/cf-news-worker/.env"

if [ ! -f "$ENV_FILE" ]; then
    echo "Error: $ENV_FILE not found"
    exit 1
fi

# Source .env to get variable values
set -a
source "$ENV_FILE"
set +a

SECRETS=(
    CF_API_TOKEN
    KV_NAMESPACE_ID
    ZONE_ID
    ROUTE_PATTERN
    JWT_SECRET
    OPENROUTER_API_KEY
    NVIDIA_API_KEY
    MANGO_API_KEY
    GROQ_API_KEY
    TURNSTILE_SECRET
    TURNSTILE_SITE_KEY
    D1_DATABASE_ID
)

echo "==> Syncing secrets to GitHub repository..."
for key in "${SECRETS[@]}"; do
    value="${!key:-}"
    if [ -n "$value" ]; then
        echo "$key -> gh secret set"
        echo "$value" | gh secret set "$key" --repo "$(gh repo view --json nameWithOwner -q .nameWithOwner 2>/dev/null || echo 'everhopingandwaiting/cf-news')"
    else
        echo "SKIP $key (empty)"
    fi
done

echo "==> Done."

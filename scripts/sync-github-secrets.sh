#!/usr/bin/env bash
# sync-github-secrets.sh — Push secrets from .env to GitHub Actions repo secrets.
# Encryption runs inside Docker (node:20-slim + tweetsodium).
#
# Usage:  GITHUB_PAT=ghp_xxx ./scripts/sync-github-secrets.sh
# Or:     auto-reads GITHUB_PAT from cf-news-worker/.env

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="$ROOT/cf-news-worker/.env"
[ -f "$ENV_FILE" ] || { echo "Error: $ENV_FILE not found"; exit 1; }

# Source .env
set -a; source "$ENV_FILE"; set +a
GITHUB_PAT="${GITHUB_PAT:-${GITHUB_TOKEN:-}}"
[ -n "$GITHUB_PAT" ] || { echo "Error: GITHUB_PAT not set in .env"; exit 1; }

GITHUB_REPO="${GITHUB_REPO:-$(git -C "$ROOT" remote get-url origin 2>/dev/null | sed -n 's|.*github.com[:/]\(.*\)\.git|\1|p')}"
[ -n "$GITHUB_REPO" ] || { echo "Error: cannot determine repo"; exit 1; }

API_BASE="https://api.github.com/repos/${GITHUB_REPO}/actions/secrets"

echo "==> Fetching public key for ${GITHUB_REPO}..."
PUBKEY_JSON=$(curl -sf -H "Authorization: Bearer ${GITHUB_PAT}" "${API_BASE}/public-key")
PUBKEY_ID=$(echo "$PUBKEY_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin)['key_id'])")
PUBKEY=$(echo "$PUBKEY_JSON" | python3 -c "import sys,json;print(json.load(sys.stdin)['key'])")
echo "    key_id=${PUBKEY_ID}"

# key=local_env_var_name  (for reading from .env)
# value=github_secret_name (for the GitHub API)
SECRETS=(
    "CLOUDFLARE_API_TOKEN=CF_API_TOKEN"
    "KV_NAMESPACE_ID=KV_NAMESPACE_ID"
    "ZONE_ID=ZONE_ID"
    "ROUTE_PATTERN=ROUTE_PATTERN"
    "JWT_SECRET=JWT_SECRET"
"OPENROUTER_API_KEY=OPENROUTER_API_KEY"
"NVIDIA_API_KEY=NVIDIA_API_KEY"
"MANGO_API_KEY=MANGO_API_KEY"
"FREEMODEL_API_KEY=FREEMODEL_API_KEY"
    "GROQ_API_KEY=GROQ_API_KEY"
    "TURNSTILE_SECRET=TURNSTILE_SECRET"
    "TURNSTILE_SITE_KEY=TURNSTILE_SITE_KEY"
    "D1_DATABASE_ID=D1_DATABASE_ID"
)

echo "==> Syncing secrets..."
for entry in "${SECRETS[@]}"; do
    local_key="${entry%%=*}"
    github_key="${entry#*=}"
    value="${!local_key:-}"
    [ -z "$value" ] && { echo "    SKIP $local_key (empty)"; continue; }

    encrypted=$(docker run --rm -i -e PUBKEY="$PUBKEY" node:20-slim bash -c '
cd /tmp && npm init -y >/dev/null 2>&1 && npm install tweetsodium --silent 2>&1 | tail -1
node -e "
const ts = require(\"tweetsodium\");
const key = Buffer.from(process.env.PUBKEY, \"base64\");
const stdin = require(\"fs\").readFileSync(0, \"utf-8\").trim();
const enc = ts.seal(Buffer.from(stdin), key);
console.log(Buffer.from(enc).toString(\"base64\"));
"' <<< "$value" 2>/dev/null)

    status=$(curl -sf -o /dev/null -w "%{http_code}" -X PUT "${API_BASE}/${github_key}" \
        -H "Authorization: Bearer ${GITHUB_PAT}" \
        -H "Content-Type: application/json" \
        -d "{\"encrypted_value\":\"${encrypted}\",\"key_id\":\"${PUBKEY_ID}\"}")
    echo "    ${github_key} -> HTTP ${status}"
done

echo "==> Done."

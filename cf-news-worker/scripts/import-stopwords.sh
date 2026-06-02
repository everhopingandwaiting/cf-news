#!/usr/bin/env bash
# Generate import SQL from stopwords.txt
# Output: src/db/stopwords-import.sql
#
# Then run with:
#   docker run --rm --env-file .env -v $(pwd)/src/db/stopwords-import.sql:/app/import.sql \
#     cf-news-worker npx wrangler d1 execute news-db --remote --file=./import.sql
#
# (wrangler.toml needs database_id for remote ops, see AGENTS.md)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
STOPWORDS_FILE="$SCRIPT_DIR/../src/db/stopwords.txt"
OUT_SQL="$SCRIPT_DIR/../src/db/stopwords-import.sql"

current_source="unknown"
{ echo "DELETE FROM stop_words;"
  while IFS= read -r line; do
    word="${line## }"
    word="${word%% }"
    [ -z "$word" ] && continue
    case "$word" in
      "# English"*) current_source="smart" ;;
      "# Chinese"*) current_source="cn" ;;
      "# HTML"*) current_source="html" ;;
    esac
    [[ "$word" == \#* ]] && continue
    escaped="${word//\'/\'\'}"
    echo "INSERT OR IGNORE INTO stop_words (word, source) VALUES ('$escaped', '$current_source');"
  done < "$STOPWORDS_FILE"
} > "$OUT_SQL"

count=$(grep -c 'INSERT' "$OUT_SQL")
echo "Generated $OUT_SQL ($count words)"
echo "Run 'wrangler d1 execute news-db --remote --file=src/db/stopwords-import.sql' to import"

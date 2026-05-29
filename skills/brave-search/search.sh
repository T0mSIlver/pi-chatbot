#!/usr/bin/env bash
set -euo pipefail

QUERY="${1:?Usage: search.sh \"query\" [count]}"
COUNT="${2:-5}"

if [ -z "${BRAVE_API_KEY:-}" ]; then
  echo "Error: BRAVE_API_KEY environment variable is not set." >&2
  exit 1
fi

ENCODED_QUERY=$(QUERY="$QUERY" python3 -c "import os, urllib.parse; print(urllib.parse.quote(os.environ['QUERY']))")

curl -s "https://api.search.brave.com/res/v1/web/search?q=${ENCODED_QUERY}&count=${COUNT}" \
  -H "Accept: application/json" \
  -H "Accept-Encoding: gzip" \
  -H "X-Subscription-Token: ${BRAVE_API_KEY}" \
  --compressed | python3 -c "
import json, sys
data = json.load(sys.stdin)
results = data.get('web', {}).get('results', [])
for r in results:
    print(f\"## {r.get('title', 'No title')}\")
    print(f\"URL: {r.get('url', '')}\")
    print(f\"{r.get('description', 'No description')}\")
    print()
if not results:
    print('No results found.')
"

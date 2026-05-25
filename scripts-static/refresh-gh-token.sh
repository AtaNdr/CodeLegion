#!/usr/bin/env bash
#
# refresh-gh-token.sh (v2)
#
# Fetches secrets from the controller's /agent/secrets endpoint, caches them
# locally with a TTL, and prints export statements for the calling shell to
# eval. The GH App private key NEVER lives on this VM — the controller mints
# a fresh installation token per call.
#
# Usage: eval "$(refresh-gh-token.sh)"

set -uo pipefail

CACHE_DIR="/var/lib/agent"
CACHE_FILE="$CACHE_DIR/secrets.cache"
CACHE_TTL_SECONDS=$((45 * 60))  # 45 min; installation tokens last 60 min

mkdir -p "$CACHE_DIR" 2>/dev/null || true

# Try cache first
if [[ -f "$CACHE_FILE" ]]; then
  cached_at=$(stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0)
  now=$(date +%s)
  age=$((now - cached_at))
  if (( age < CACHE_TTL_SECONDS )); then
    cat "$CACHE_FILE"
    exit 0
  fi
fi

CONTROLLER_URL="${CONTROLLER_URL:-}"
REPORT_TOKEN="${REPORT_TOKEN:-}"
if [[ -z "$CONTROLLER_URL" || -z "$REPORT_TOKEN" ]]; then
  echo "echo 'refresh-gh-token: CONTROLLER_URL/REPORT_TOKEN not set' >&2" >&2
  exit 1
fi

resp=$(curl -sS --max-time 15 \
  -H "Authorization: Bearer $REPORT_TOKEN" \
  "$CONTROLLER_URL/agent/secrets" 2>/dev/null) || {
  echo "echo 'refresh-gh-token: controller fetch failed' >&2" >&2
  exit 1
}

# Expecting {"anthropicApiKey":"...", "githubToken":"...", "repoUrl":"..."}
anthropic=$(echo "$resp" | jq -r '.anthropicApiKey // empty' 2>/dev/null)
gh_token=$(echo "$resp" | jq -r '.githubToken // empty' 2>/dev/null)
repo_url=$(echo "$resp" | jq -r '.repoUrl // empty' 2>/dev/null)

if [[ -z "$gh_token" ]]; then
  echo "echo 'refresh-gh-token: empty token in response' >&2" >&2
  exit 1
fi

output="export ANTHROPIC_API_KEY=$(printf %q "$anthropic")
export GITHUB_TOKEN=$(printf %q "$gh_token")
export GH_TOKEN=$(printf %q "$gh_token")"
[[ -n "$repo_url" ]] && output="$output
export REPO_URL=$(printf %q "$repo_url")"

# Cache for next call
umask 077
echo "$output" > "$CACHE_FILE"

echo "$output"

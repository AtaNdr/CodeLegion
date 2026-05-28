#!/usr/bin/env bash
#
# agent-bootstrap.sh (v2)
#
# Runs once per VM on first boot. Generates an identity (name/emoji/voice) and
# writes ~/.agent-identity.json. Identity is picked by Claude itself so each
# agent has a distinct PR voice.

set -uo pipefail

IDENTITY_FILE="$HOME/.agent-identity.json"

if [[ -f "$IDENTITY_FILE" ]]; then
  echo "[bootstrap] Identity already exists at $IDENTITY_FILE"
  exit 0
fi

mkdir -p "$(dirname "$IDENTITY_FILE")"

write_anon() {
  local why="$1"
  echo "[bootstrap] $why; writing anonymous identity" >&2
  cat > "$IDENTITY_FILE" <<EOF
{
  "name": "Agent-$RANDOM",
  "emoji": "🤖",
  "voice": "professional and concise",
  "signoff": "— agent"
}
EOF
}

# Pull ANTHROPIC_API_KEY into env if missing. Cloud-init's bootstrap line
# runs `eval $(refresh-gh-token.sh)` before us, but if that eval silently
# failed (controller blip, NAT cold start, anything), claude is invoked
# without a key, returns 401 swallowed by 2>/dev/null, and the agent gets
# stuck with the fallback identity for its whole lifetime.
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  [[ -f /etc/agent/env ]] && source /etc/agent/env
  if [[ -x /usr/local/bin/refresh-gh-token.sh ]]; then
    eval "$(/usr/local/bin/refresh-gh-token.sh 2>/tmp/bootstrap-refresh.err)" || true
  fi
fi

if ! command -v claude &>/dev/null; then
  write_anon "claude CLI not found"
  exit 0
fi
if [[ -z "${ANTHROPIC_API_KEY:-}" ]]; then
  echo "[bootstrap] refresh-gh-token stderr:" >&2
  [[ -s /tmp/bootstrap-refresh.err ]] && head -c 500 /tmp/bootstrap-refresh.err >&2
  write_anon "ANTHROPIC_API_KEY unset after refresh"
  exit 0
fi

# Use Claude to generate an identity. Capture stderr so we can surface real
# failure causes (auth, rate limit, network) instead of silently falling back.
PROMPT='Pick a distinctive identity for a coding agent. Output ONLY a JSON object with: name (a memorable single first name, capitalized), emoji (one emoji that fits the personality), voice (one short sentence describing tone), signoff (one short line ending with the name). Be creative — names should not repeat common LLM defaults like "Claude" or "Alex".'

resp=$(claude --dangerously-skip-permissions --model "${CLAUDE_MODEL:-claude-haiku-4-5-20251001}" --max-turns 1 -p "$PROMPT" 2>/tmp/bootstrap-claude.err || echo "")

# Extract JSON from response
identity_json=$(echo "$resp" | grep -oP '\{[^{}]*"name"[^{}]*\}' | head -1)
if [[ -z "$identity_json" ]] || ! echo "$identity_json" | jq -e . &>/dev/null; then
  echo "[bootstrap] claude produced no parseable identity. stderr:" >&2
  [[ -s /tmp/bootstrap-claude.err ]] && head -c 500 /tmp/bootstrap-claude.err >&2
  write_anon "could not parse identity"
else
  echo "$identity_json" > "$IDENTITY_FILE"
fi

cat "$IDENTITY_FILE"
echo "[bootstrap] Identity written to $IDENTITY_FILE"

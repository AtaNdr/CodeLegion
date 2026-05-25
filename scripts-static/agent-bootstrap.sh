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

if ! command -v claude &>/dev/null; then
  echo "[bootstrap] claude CLI not found; writing anonymous identity"
  cat > "$IDENTITY_FILE" <<EOF
{
  "name": "Agent-$RANDOM",
  "emoji": "🤖",
  "voice": "professional and concise",
  "signoff": "— agent"
}
EOF
  exit 0
fi

# Use Claude to generate an identity.
PROMPT='Pick a distinctive identity for a coding agent. Output ONLY a JSON object with: name (a memorable single first name, capitalized), emoji (one emoji that fits the personality), voice (one short sentence describing tone), signoff (one short line ending with the name). Be creative — names should not repeat common LLM defaults like "Claude" or "Alex".'

resp=$(claude --dangerously-skip-permissions --model "${CLAUDE_MODEL:-claude-haiku-4-5-20251001}" --max-turns 1 -p "$PROMPT" 2>/dev/null || echo "")

# Extract JSON from response
identity_json=$(echo "$resp" | grep -oP '\{[^{}]*"name"[^{}]*\}' | head -1)
if [[ -z "$identity_json" ]] || ! echo "$identity_json" | jq -e . &>/dev/null; then
  echo "[bootstrap] Could not parse identity; writing anonymous"
  cat > "$IDENTITY_FILE" <<EOF
{
  "name": "Agent-$RANDOM",
  "emoji": "🤖",
  "voice": "professional and concise",
  "signoff": "— agent"
}
EOF
else
  echo "$identity_json" > "$IDENTITY_FILE"
fi

cat "$IDENTITY_FILE"
echo "[bootstrap] Identity written to $IDENTITY_FILE"

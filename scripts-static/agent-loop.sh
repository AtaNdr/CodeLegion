#!/usr/bin/env bash
#
# agent-loop.sh (v2)
#
# Main poll-claim-work-PR loop. Differences from v1:
#   - No `with-secrets` wrapper. Secrets come from /agent/secrets via
#     refresh-gh-token.sh (which also exports ANTHROPIC_API_KEY).
#   - Activity push: every state change AND every 10s heartbeat POSTs
#     updates to the controller, so the UI sees what each VM is doing
#     in near real time. VM-local /var/lib/agent/activity.jsonl is the
#     source of truth.

set -uo pipefail

# ---- Self-heal: clone workspace if missing -------------------------
if [[ ! -d "/workspace/.git" ]]; then
  echo "[init] Workspace missing — refreshing token and cloning"
  eval "$(/usr/local/bin/refresh-gh-token.sh 2>/tmp/refresh-err.log)" || true
  if [[ -n "${GITHUB_TOKEN:-}" && -n "${REPO_URL:-}" ]]; then
    AUTH_URL=$(echo "$REPO_URL" | sed 's|https://|https://x-access-token:'"$GITHUB_TOKEN"'@|')
    git clone "$AUTH_URL" /workspace 2>&1 || { echo "[init] clone failed"; cat /tmp/refresh-err.log; exit 1; }
  fi
fi
cd /workspace || exit 1

# ---- Identity --------------------------------------------------
IDENTITY_FILE="$HOME/.agent-identity.json"
if [[ ! -f "$IDENTITY_FILE" ]]; then
  /usr/local/bin/agent-bootstrap.sh || echo "[init] bootstrap failed"
fi
NAME=$(jq -r .name "$IDENTITY_FILE" 2>/dev/null || echo "agent")
NAME_LOWER=$(echo "$NAME" | tr '[:upper:]' '[:lower:]')
EMOJI=$(jq -r .emoji "$IDENTITY_FILE" 2>/dev/null || echo "🤖")
SIGNOFF=$(jq -r .signoff "$IDENTITY_FILE" 2>/dev/null || echo "— agent")
CLAIM_LABEL="agent:$NAME_LOWER"

MODEL="${MODEL:-sonnet}"
MODEL_LABEL="model:$MODEL"
case "$MODEL" in
  haiku)  CLAUDE_MODEL="claude-haiku-4-5-20251001" ;;
  sonnet) CLAUDE_MODEL="claude-sonnet-4-6" ;;
  opus)   CLAUDE_MODEL="claude-opus-4-7" ;;
  *)      CLAUDE_MODEL="claude-sonnet-4-6" ;;
esac

POLL_INTERVAL="${POLL_INTERVAL:-60}"
IDLE_TIMEOUT="${IDLE_TIMEOUT:-600}"
LAST_WORK_TIME=$(date +%s)

CONTROLLER_URL="${CONTROLLER_URL:-}"
REPORT_TOKEN="${REPORT_TOKEN:-}"

# ---- Local activity files --------------------------------------
mkdir -p /var/lib/agent
ACTIVITY_FILE=/var/lib/agent/activity.jsonl
STATUS_FILE=/var/lib/agent/status.json
SYNC_OFFSET_FILE=/var/lib/agent/last-sync-offset
touch "$ACTIVITY_FILE" "$STATUS_FILE" "$SYNC_OFFSET_FILE"

VM_NAME=$(curl -sf -m 2 -H "Metadata:true" \
  "http://169.254.169.254/metadata/instance/compute/name?api-version=2021-02-01&format=text" 2>/dev/null || hostname)

# ---- Status helpers --------------------------------------------
write_status() {
  local state="$1"; local issue="${2:-}"; local summary="${3:-}"
  local ts; ts=$(date -u +%FT%TZ)
  local line; line=$(jq -nc --arg ts "$ts" --arg s "$state" --arg i "$issue" --arg sm "$summary" \
    '{ts:$ts, state:$s, issue:$i, summary:$sm}')
  echo "$line" >> "$ACTIVITY_FILE"
  echo "$line" > "$STATUS_FILE"
  push_status "$state" "$issue" "$summary"
}

push_status() {
  [[ -z "$CONTROLLER_URL" || -z "$REPORT_TOKEN" ]] && return 0
  local payload
  payload=$(jq -nc --arg vm "$VM_NAME" --arg s "$1" --arg i "${2:-}" --arg sm "${3:-}" \
    '{vmName:$vm, state:$s, issue:$i, summary:$sm}')
  curl -sS -X POST "$CONTROLLER_URL/agent/status" \
    -H "Authorization: Bearer $REPORT_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload" --max-time 5 &>/dev/null &
}

heartbeat_sync() {
  [[ -z "$CONTROLLER_URL" || -z "$REPORT_TOKEN" ]] && return 0
  local offset; offset=$(cat "$SYNC_OFFSET_FILE" 2>/dev/null || echo 0)
  local size; size=$(stat -c%s "$ACTIVITY_FILE" 2>/dev/null || echo 0)
  if (( size <= offset )); then return 0; fi
  local lines; lines=$(tail -c +$((offset + 1)) "$ACTIVITY_FILE")
  [[ -z "$lines" ]] && return 0
  local payload
  payload=$(jq -nc --arg vm "$VM_NAME" --arg ls "$lines" --argjson off "$offset" \
    '{vmName:$vm, lines:$ls, fromOffset:$off}')
  if curl -sS -X POST "$CONTROLLER_URL/agent/sync" \
      -H "Authorization: Bearer $REPORT_TOKEN" \
      -H "Content-Type: application/json" \
      -d "$payload" --max-time 10 &>/dev/null; then
    echo "$size" > "$SYNC_OFFSET_FILE"
  fi
}

log() { echo "[$(date -u +%FT%TZ)] [$NAME/$MODEL] $*"; }

remote_log() {
  [[ -z "$CONTROLLER_URL" || -z "$REPORT_TOKEN" ]] && return 0
  local level="${1:-info}"; local message="$2"
  local payload
  payload=$(jq -nc --arg a "$NAME" --arg vm "$VM_NAME" --arg lvl "$level" --arg m "$message" \
    '{agent:$a, vmName:$vm, level:$lvl, message:$m}')
  curl -sS -X POST "$CONTROLLER_URL/agent/log" \
    -H "Authorization: Bearer $REPORT_TOKEN" \
    -H "Content-Type: application/json" \
    -d "$payload" --max-time 5 &>/dev/null &
}

refresh_token() { eval "$(/usr/local/bin/refresh-gh-token.sh 2>/dev/null)"; }

report_cost() {
  local issue_num="$1"; local claude_output="$2"; local duration_seconds="$3"; local kind="${4:-task}"
  [[ -z "$CONTROLLER_URL" || -z "$REPORT_TOKEN" ]] && return 0
  [[ ! -f "$claude_output" ]] && return 0
  local usage
  usage=$(jq -s '
    [.[] | select(.type == "result" or .type == "message" or has("usage")) | .usage // empty]
    | reduce .[] as $u ({"input_tokens":0,"output_tokens":0,"cache_creation_input_tokens":0,"cache_read_input_tokens":0};
        .input_tokens += ($u.input_tokens // 0)
        | .output_tokens += ($u.output_tokens // 0)
        | .cache_creation_input_tokens += ($u.cache_creation_input_tokens // 0)
        | .cache_read_input_tokens += ($u.cache_read_input_tokens // 0))' "$claude_output" 2>/dev/null || echo '{}')
  local input output cc cr
  input=$(echo "$usage" | jq '.input_tokens // 0')
  output=$(echo "$usage" | jq '.output_tokens // 0')
  cc=$(echo "$usage" | jq '.cache_creation_input_tokens // 0')
  cr=$(echo "$usage" | jq '.cache_read_input_tokens // 0')
  [[ "$input" == "0" && "$output" == "0" ]] && return 0
  local payload
  payload=$(jq -nc \
    --arg a "$NAME" --arg m "$MODEL" --arg i "$issue_num" --arg k "$kind" \
    --argjson inp "$input" --argjson out "$output" --argjson cc "$cc" --argjson cr "$cr" --argjson d "$duration_seconds" \
    '{agent:$a, model:$m, issue:$i, kind:$k, input:$inp, output:$out, cacheCreate:$cc, cacheRead:$cr, durationSeconds:$d}')
  curl -sS -X POST "$CONTROLLER_URL/cost/report" \
    -H "Authorization: Bearer $REPORT_TOKEN" -H "Content-Type: application/json" \
    -d "$payload" --max-time 30 &>/dev/null
}

self_deallocate() {
  log "Idle timeout — deallocating."
  write_status "deallocating"
  refresh_token
  # Release any forgotten claim
  local claimed; claimed=$(gh issue list --label "$CLAIM_LABEL" --state open --json number -q '.[].number' 2>/dev/null || echo "")
  for I in $claimed; do
    gh issue edit "$I" --remove-label "$CLAIM_LABEL" --add-label "agent-ready" 2>/dev/null || true
  done

  if curl -s -m 2 -H "Metadata:true" "http://169.254.169.254/metadata/instance?api-version=2021-02-01" &>/dev/null; then
    curl -sS -X POST "$CONTROLLER_URL/agent/deallocate" \
      -H "Authorization: Bearer $REPORT_TOKEN" -H "Content-Type: application/json" \
      -d "{\"vmName\":\"$VM_NAME\",\"agentName\":\"$NAME\"}" --max-time 30 &>/dev/null || true
    sleep 300
  else
    sudo shutdown -h now
  fi
  exit 0
}

# ---- Main loop -------------------------------------------------
log "Online. Model: $MODEL. Polling every ${POLL_INTERVAL}s."
write_status "starting"
remote_log "info" "online model=$MODEL idle_timeout=${IDLE_TIMEOUT}s"
refresh_token

# Background heartbeat (every 10s) — pushes any unsynced activity lines.
(
  while sleep 10; do heartbeat_sync; done
) &

while true; do
  refresh_token
  write_status "idle"

  if (( IDLE_TIMEOUT > 0 )); then
    NOW=$(date +%s); IDLE_FOR=$((NOW - LAST_WORK_TIME))
    if (( IDLE_FOR >= IDLE_TIMEOUT )); then self_deallocate; fi
  fi

  git fetch --all --quiet 2>/dev/null || true
  git checkout main 2>/dev/null || git checkout master 2>/dev/null || true
  git pull --quiet 2>/dev/null || true

  ISSUE_JSON=$(gh issue list --label "agent-ready" --state open --json number,title,body,labels --limit 50 2>/dev/null || echo "[]")
  ISSUE_NUM=$(echo "$ISSUE_JSON" | jq -r --arg ML "$MODEL_LABEL" '
    [.[] | select(
      (.labels | map(.name) | any(test("^agent:") and . != "agent:needs-revision" and . != "agent:blocked" and . != "agent:do-not-pick" and . != "agent:approved")) | not
    ) | select(
      .labels | map(.name) | any(. == $ML)
    )] | sort_by(.number) | .[0].number // empty')

  if [[ -z "$ISSUE_NUM" ]]; then
    sleep "$POLL_INTERVAL"; continue
  fi

  log "Attempting to claim #$ISSUE_NUM"
  if ! gh issue edit "$ISSUE_NUM" --add-label "$CLAIM_LABEL" --remove-label "agent-ready" 2>&1 | tee /tmp/claim.log; then
    log "Claim failed for #$ISSUE_NUM."; sleep 10; continue
  fi

  CURRENT_CLAIMS=$(gh issue view "$ISSUE_NUM" --json labels -q '[.labels[].name | select(startswith("agent:") and . != "agent:needs-revision" and . != "agent:blocked" and . != "agent:do-not-pick")]')
  CLAIM_COUNT=$(echo "$CURRENT_CLAIMS" | jq 'length')
  if (( CLAIM_COUNT > 1 )); then
    log "Race detected. Yielding."
    gh issue edit "$ISSUE_NUM" --remove-label "$CLAIM_LABEL" 2>/dev/null || true
    sleep 30; continue
  fi

  LAST_WORK_TIME=$(date +%s)
  ISSUE_TITLE=$(gh issue view "$ISSUE_NUM" --json title -q .title)
  write_status "claimed" "$ISSUE_NUM" "claimed: $ISSUE_TITLE"

  SLUG=$(echo "$ISSUE_TITLE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-\|-$//g' | cut -c1-40)
  BRANCH="$NAME_LOWER/issue-$ISSUE_NUM-$SLUG"

  write_status "planning" "$ISSUE_NUM" "reading issue and planning"

  TASK_PROMPT="You are $NAME $EMOJI on $MODEL. Identity in ~/.agent-identity.json. Claimed issue #$ISSUE_NUM ($ISSUE_TITLE). Branch will be $BRANCH. Read CLAUDE.md, COMMENT_STYLE.md, CONTEXT.md, ARCHITECTURE.md, then implement: post a plan, create branch, code, tests, PR. Body must include 'Closes #$ISSUE_NUM'."

  task_log="/var/log/agent-task-$ISSUE_NUM.log"
  task_json="/tmp/claude-task-$ISSUE_NUM.json"
  task_start=$(date +%s)

  write_status "coding" "$ISSUE_NUM" "executing Claude Code"

  if timeout 90m claude --dangerously-skip-permissions --model "$CLAUDE_MODEL" \
      --max-turns 100 --output-format stream-json --verbose \
      -p "$TASK_PROMPT" 2>&1 | tee "$task_json" | tee "$task_log"; then
    write_status "completed" "$ISSUE_NUM" "task completed"
    remote_log "info" "claude finished #$ISSUE_NUM ok"
  else
    EXIT_CODE=$?
    write_status "failed" "$ISSUE_NUM" "exit code $EXIT_CODE"
    remote_log "error" "claude exited #$ISSUE_NUM code=$EXIT_CODE"
    refresh_token
    PR_NUM=$(gh pr list --head "$BRANCH" --json number -q '.[0].number' 2>/dev/null || echo "")
    if [[ -z "$PR_NUM" ]]; then
      gh issue comment "$ISSUE_NUM" --body "$SIGNOFF ran out of budget without opening a PR. Unclaiming." 2>/dev/null || true
      gh issue edit "$ISSUE_NUM" --remove-label "$CLAIM_LABEL" --add-label "agent-ready" 2>/dev/null || true
    fi
  fi

  task_duration=$(($(date +%s) - task_start))
  report_cost "$ISSUE_NUM" "$task_json" "$task_duration" "task"

  LAST_WORK_TIME=$(date +%s)
  sleep "$POLL_INTERVAL"
done

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

# ---- Onboarding ------------------------------------------------
# A fresh repo ships CONTEXT.md / ARCHITECTURE.md / DESIGN.md with the
# placeholder marker "<!-- explorer: empty -->". CLAUDE.md tells regular
# tasks to halt until those are filled. The first agent's job is to fill
# them: it creates (or claims) an `agent:onboarding` issue, writes the
# three files, and opens a PR. Regular work is gated until that's done.
ONBOARDING_LABEL="agent:onboarding"

repo_needs_onboarding() {
  local f
  for f in CONTEXT.md ARCHITECTURE.md DESIGN.md; do
    [[ ! -f "$f" ]] && return 0
    grep -q '<!-- explorer: empty -->' "$f" && return 0
  done
  return 1
}

# Ensure exactly one open onboarding issue exists. Echoes its number on
# stdout (empty on failure). All diagnostics go to stderr so they don't
# pollute the captured number.
ensure_onboarding_issue() {
  local existing
  existing=$(gh issue list --label "$ONBOARDING_LABEL" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
  if [[ -n "$existing" && "$existing" != "null" ]]; then
    echo "$existing"; return 0
  fi
  log "Creating onboarding issue" >&2

  local body url num
  body=$(cat <<'OBEOF'
## What this is

The three agent context files (`CONTEXT.md`, `ARCHITECTURE.md`, `DESIGN.md`) are missing or still contain the `<!-- explorer: empty -->` placeholder. **No agent can do regular work until these are filled in — all regular work is halted until this issue is closed.**

You are the agent responsible for this. Do not block or unclaim it. Do NOT apply CLAUDE.md's "do not start regular work" rule to yourself — that rule exists to protect regular tasks; THIS task is the one that fixes the gate.

## Your task

Read every source file in the repo — don't skim. Read `package.json` / `go.mod` / `requirements.txt` / equivalent, the directory tree, and any README. Then write these three files from scratch, replacing the `<!-- explorer: empty -->` marker in each with real, thorough content.

### CONTEXT.md — how to work in this repo
- One-paragraph description of what the project does and who it's for
- Stack: language(s), framework(s), database, test framework, package manager — with versions if visible
- Copy-pasteable commands for: install, run locally, run tests, lint, format, type-check — verified to actually work
- Key directories — one line each on what lives there
- Conventions the codebase follows (naming, file organisation, patterns)
- Gotchas: anything that would surprise a new contributor
- How to run the project locally end-to-end

### ARCHITECTURE.md — the *why*, not just the *what*
- How the major pieces communicate (data flow, API boundaries, event paths)
- Why the top-level split exists (not just what the folders are, but why they're separate)
- External integrations and what they're used for
- Anything that looks odd or over-engineered but is intentional — explain it
- Anywhere the architecture is under stress or in transition
- Mark uncertainty with "OPEN QUESTION: ..."

### DESIGN.md — the UI contract
If the project has UI:
- Frameworks/libraries (component library, CSS approach, animation)
- Design tokens in use: colours, spacing scale, typography, breakpoints — actual values
- Patterns that are consistent and must be preserved
- Patterns that are inconsistent and need a decision
- A proposed contract: declarative rules going forward (e.g. "all buttons use `<Button>`, never a raw `<button>`")
- Open questions for the human

If no UI exists: say so in one sentence and note any constraints affecting future UI work.

## Acceptance criteria

- [ ] `CONTEXT.md` has no `<!-- explorer: empty -->` marker and contains real, project-specific content
- [ ] `ARCHITECTURE.md` has no marker and explains the *why*
- [ ] `DESIGN.md` has no marker and either documents the UI contract or clearly states there's no UI
- [ ] A PR titled "Initial agent fleet context" is open, labelled `agent:do-not-pick`
- [ ] This issue is referenced from the PR and closes when the PR merges

## Steps

1. Create a branch and push it
2. Read the entire codebase before writing anything
3. Write all three files — real content, no placeholders, no filler
4. Open the PR titled "Initial agent fleet context"; body summarises findings and lists open questions
5. Add label `agent:do-not-pick` to the PR
6. Comment on this issue with the PR link

Be thorough — every future agent depends on these files to understand the codebase.
OBEOF
)

  url=$(gh issue create \
    --title "Onboard the fleet: write CONTEXT.md, ARCHITECTURE.md, DESIGN.md" \
    --label "agent-ready" --label "$ONBOARDING_LABEL" \
    --body "$body" 2>/dev/null) || { log "Failed to create onboarding issue" >&2; echo ""; return 1; }

  num=$(echo "$url" | grep -oE '[0-9]+$' | tail -1)
  log "Created onboarding issue #$num" >&2
  echo "$num"
}

# ---- Script self-update ----------------------------------------
# cloud-init only downloads these scripts once, at VM creation. A
# deallocate→start cycle does NOT re-run cloud-init, so a long-lived VM
# would keep running stale agent code forever. To let fixes propagate
# without delete+recreate, re-fetch the scripts from the controller while
# idle; if agent-loop.sh changed, re-exec into the new version.
#
# Only ever runs between tasks (never mid-work), so a re-exec can't
# interrupt an in-flight issue.
self_update_scripts() {
  local base="${SCRIPTS_BASE:-}"
  [[ -z "$base" ]] && return 0

  local s tmp
  for s in refresh-gh-token.sh agent-bootstrap.sh; do
    tmp=$(mktemp)
    if curl -fsSL --max-time 15 "$base/$s" -o "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
      if ! cmp -s "$tmp" "/usr/local/bin/$s"; then
        log "Updating /usr/local/bin/$s from controller"
        sudo cp "$tmp" "/usr/local/bin/$s" && sudo chmod +x "/usr/local/bin/$s"
      fi
    fi
    rm -f "$tmp"
  done

  # agent-loop.sh last: if it changed, swap and re-exec into the new copy.
  tmp=$(mktemp)
  if curl -fsSL --max-time 15 "$base/agent-loop.sh" -o "$tmp" 2>/dev/null && [[ -s "$tmp" ]]; then
    if ! cmp -s "$tmp" /usr/local/bin/agent-loop.sh; then
      log "agent-loop.sh changed upstream — updating and re-execing"
      remote_log "info" "self-updating agent-loop.sh and re-execing"
      sudo cp "$tmp" /usr/local/bin/agent-loop.sh && sudo chmod +x /usr/local/bin/agent-loop.sh
      rm -f "$tmp"
      exec /usr/local/bin/agent-loop.sh
    fi
  fi
  rm -f "$tmp"
}

# ---- Main loop -------------------------------------------------
log "Online. Model: $MODEL. Polling every ${POLL_INTERVAL}s."
write_status "starting"
remote_log "info" "online model=$MODEL idle_timeout=${IDLE_TIMEOUT}s"
refresh_token
self_update_scripts  # adopt any newer scripts before doing anything

# Background heartbeat (every 10s) — pushes any unsynced activity lines.
(
  while sleep 10; do heartbeat_sync; done
) &

while true; do
  refresh_token
  self_update_scripts  # re-check for script updates each idle cycle
  write_status "idle"

  if (( IDLE_TIMEOUT > 0 )); then
    NOW=$(date +%s); IDLE_FOR=$((NOW - LAST_WORK_TIME))
    if (( IDLE_FOR >= IDLE_TIMEOUT )); then self_deallocate; fi
  fi

  git fetch --all --quiet 2>/dev/null || true
  git checkout main 2>/dev/null || git checkout master 2>/dev/null || true
  git pull --quiet 2>/dev/null || true

  # --- Onboarding gate ---------------------------------------------
  # If context files are empty, work ONLY the onboarding issue. CRITICAL:
  # when onboarding is needed we must NEVER fall through to claim a regular
  # issue — otherwise the user's issue gets claimed-and-abandoned while the
  # repo is un-onboarded. ensure_onboarding_issue returns the issue number
  # directly (no lag-prone label-search round trip).
  IS_ONBOARDING_TASK="false"
  NEEDS_ONBOARDING="false"
  if repo_needs_onboarding; then
    NEEDS_ONBOARDING="true"
    ONBOARDING_NUM=$(ensure_onboarding_issue)
  else
    ONBOARDING_NUM=$(gh issue list --label "$ONBOARDING_LABEL" --state open --json number -q '.[0].number' 2>/dev/null || echo "")
  fi

  if [[ "$NEEDS_ONBOARDING" == "true" || ( -n "$ONBOARDING_NUM" && "$ONBOARDING_NUM" != "null" ) ]]; then
    if [[ -z "$ONBOARDING_NUM" || "$ONBOARDING_NUM" == "null" ]]; then
      # Onboarding needed but we couldn't resolve/create the issue this
      # cycle. Wait and retry — do NOT claim regular issues.
      log "Onboarding needed but onboarding issue unresolved this cycle. Waiting."
      sleep "$POLL_INTERVAL"; continue
    fi
    # Is the onboarding issue already claimed by some agent?
    OB_CLAIM_COUNT=$(gh issue view "$ONBOARDING_NUM" --json labels \
      -q '[.labels[].name | select(startswith("agent:") and . != "agent:onboarding" and . != "agent:needs-revision" and . != "agent:blocked" and . != "agent:do-not-pick" and . != "agent:approved")] | length' 2>/dev/null || echo 0)
    if (( OB_CLAIM_COUNT > 0 )); then
      log "Onboarding #$ONBOARDING_NUM in progress by another agent. Waiting."
      sleep "$POLL_INTERVAL"; continue
    fi
    ISSUE_NUM="$ONBOARDING_NUM"
    IS_ONBOARDING_TASK="true"
  else
    # --- Normal issue selection ------------------------------------
    ISSUE_JSON=$(gh issue list --label "agent-ready" --state open --json number,title,body,labels --limit 50 2>/dev/null || echo "[]")
    # Sonnet (the default model) also claims issues that have NO model:* label
    # at all — matching the webhook's "default to sonnet" behavior. Haiku and
    # Opus only claim issues that explicitly request them.
    if [[ "$MODEL" == "sonnet" ]]; then
      ISSUE_NUM=$(echo "$ISSUE_JSON" | jq -r --arg ML "$MODEL_LABEL" '
        [.[] | select(
          (.labels | map(.name) | any(test("^agent:") and . != "agent:needs-revision" and . != "agent:blocked" and . != "agent:do-not-pick" and . != "agent:approved")) | not
        ) | select(
          ((.labels | map(.name) | any(. == $ML))
           or (.labels | map(.name) | any(test("^model:")) | not))
        )] | sort_by(.number) | .[0].number // empty')
    else
      ISSUE_NUM=$(echo "$ISSUE_JSON" | jq -r --arg ML "$MODEL_LABEL" '
        [.[] | select(
          (.labels | map(.name) | any(test("^agent:") and . != "agent:needs-revision" and . != "agent:blocked" and . != "agent:do-not-pick" and . != "agent:approved")) | not
        ) | select(
          .labels | map(.name) | any(. == $ML)
        )] | sort_by(.number) | .[0].number // empty')
    fi
  fi

  if [[ -z "$ISSUE_NUM" ]]; then
    sleep "$POLL_INTERVAL"; continue
  fi

  log "Attempting to claim #$ISSUE_NUM (onboarding=$IS_ONBOARDING_TASK)"
  # Claim. Onboarding issues keep agent-ready (the gate finds them by the
  # agent:onboarding label); regular issues drop agent-ready on claim.
  if [[ "$IS_ONBOARDING_TASK" == "true" ]]; then
    gh issue edit "$ISSUE_NUM" --add-label "$CLAIM_LABEL" 2>&1 | tee /tmp/claim.log || { log "Claim failed for #$ISSUE_NUM."; sleep 10; continue; }
  else
    if ! gh issue edit "$ISSUE_NUM" --add-label "$CLAIM_LABEL" --remove-label "agent-ready" 2>&1 | tee /tmp/claim.log; then
      log "Claim failed for #$ISSUE_NUM."; sleep 10; continue
    fi
  fi

  # Deterministic race resolution: let concurrent claims land, then the
  # lexicographically-smallest claim label wins. Everyone else yields by
  # removing only their own claim label. The winner never yields, so the
  # issue is never orphaned (the old bug: both racers yielded → no labels).
  sleep 3
  CLAIM_LIST=$(gh issue view "$ISSUE_NUM" --json labels \
    -q '[.labels[].name | select(startswith("agent:") and . != "agent:onboarding" and . != "agent:needs-revision" and . != "agent:blocked" and . != "agent:do-not-pick" and . != "agent:approved")] | sort | .[]' 2>/dev/null || echo "$CLAIM_LABEL")
  WINNER=$(echo "$CLAIM_LIST" | head -1)
  if [[ -n "$WINNER" && "$WINNER" != "$CLAIM_LABEL" ]]; then
    log "Race on #$ISSUE_NUM — $WINNER won, yielding."
    gh issue edit "$ISSUE_NUM" --remove-label "$CLAIM_LABEL" 2>/dev/null || true
    sleep 30; continue
  fi

  LAST_WORK_TIME=$(date +%s)
  ISSUE_TITLE=$(gh issue view "$ISSUE_NUM" --json title -q .title)
  write_status "claimed" "$ISSUE_NUM" "claimed: $ISSUE_TITLE"

  # Always leave a comment on claim — even if Claude later crashes or runs out
  # of budget, the issue shows who picked it up and what they intend to do.
  if [[ "$IS_ONBOARDING_TASK" == "true" ]]; then
    gh issue comment "$ISSUE_NUM" --body "$EMOJI **$NAME** ($MODEL) claimed this as the **onboarding task** — the repo's context files are still empty, so I'll study the codebase and draft CONTEXT/ARCHITECTURE/DESIGN, then open a PR. $SIGNOFF" 2>/dev/null || true
  else
    gh issue comment "$ISSUE_NUM" --body "$EMOJI **$NAME** ($MODEL) picked this up. Reading the repo and the issue now to decide whether to implement directly or propose triage — my decision and reasoning follow in the next comment. $SIGNOFF" 2>/dev/null || true
  fi

  SLUG=$(echo "$ISSUE_TITLE" | tr '[:upper:]' '[:lower:]' | sed 's/[^a-z0-9]/-/g' | sed 's/--*/-/g' | sed 's/^-\|-$//g' | cut -c1-40)
  BRANCH="$NAME_LOWER/issue-$ISSUE_NUM-$SLUG"

  write_status "planning" "$ISSUE_NUM" "reading issue and planning"

  if [[ "$IS_ONBOARDING_TASK" == "true" ]]; then
    write_status "planning" "$ISSUE_NUM" "onboarding: studying the repo"
    TASK_PROMPT="You are $NAME $EMOJI on $MODEL. Identity in ~/.agent-identity.json — read it first.

You claimed issue #$ISSUE_NUM — the fleet ONBOARDING task. Your job is to study this repo and write three context files from scratch, then open a PR.

> Do NOT apply CLAUDE.md's 'do not start regular work' rule to yourself. That rule blocks regular tasks when the context files are empty — but THIS task is the one that fills them. Ignore it for this issue.

Study the repo directly: read source files, package.json / go.mod / requirements.txt, the directory tree, and any README. Then write:

- CONTEXT.md — what the project does and who it's for; stack (languages, frameworks, db, test framework, package manager); copy-pasteable install/run/test/lint/format/type-check commands; key directories; conventions; gotchas.
- ARCHITECTURE.md — how the major pieces communicate (data flow, API boundaries, events); why the top-level split exists; external integrations; anything that looks odd but is intentional. Mark uncertainty with 'OPEN QUESTION: ...'.
- DESIGN.md — if there's UI: frameworks, tokens (colors/spacing/type/breakpoints), patterns to preserve, inconsistencies to resolve, a proposed contract. If no UI: say so in one sentence and note any constraints.

Every file must have its '<!-- explorer: empty -->' marker replaced with real, thorough content — no placeholders.

Steps:
1. git checkout -b $BRANCH && git push -u origin $BRANCH
2. Write all three files with real content
3. Open a PR titled 'Initial agent fleet context' — body summarises findings and open questions
4. Add label agent:do-not-pick to the PR
5. Comment on this issue with the PR link. The human merges the PR, which closes this issue and unblocks regular work."
  else
    TASK_PROMPT="You are $NAME $EMOJI on $MODEL. Identity in ~/.agent-identity.json. Claimed issue #$ISSUE_NUM ($ISSUE_TITLE). Branch will be $BRANCH.

Read CLAUDE.md, COMMENT_STYLE.md, CONTEXT.md, ARCHITECTURE.md.

Your FIRST action, before any code or branch, is to post ONE comment on issue #$ISSUE_NUM stating your decision and a one-sentence why. Use exactly this opening line then a brief reason:
- 'Decision: implement directly — <why>' (clear, scoped, testable), or
- 'Decision: propose triage — <why>' (vague, too broad, or needs splitting), or
- 'Decision: blocked — <why>' (missing info or dependency).

Then act on that decision:
- implement: post your plan, create the branch, implement, write tests, run the gates, open a PR whose body includes 'Closes #$ISSUE_NUM'.
- triage: post the triage proposal per CLAUDE.md, add label triage:proposed, remove your claim, stop.
- blocked: add label agent:blocked, stop."
  fi

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
      if [[ "$IS_ONBOARDING_TASK" == "true" ]]; then
        # Onboarding: just drop our claim. The issue keeps agent-ready +
        # agent:onboarding, so the gate re-offers it next cycle. Don't
        # re-add agent-ready (it was never removed for onboarding).
        gh issue comment "$ISSUE_NUM" --body "$SIGNOFF couldn't complete onboarding this run. Releasing for retry." 2>/dev/null || true
        gh issue edit "$ISSUE_NUM" --remove-label "$CLAIM_LABEL" 2>/dev/null || true
      else
        gh issue comment "$ISSUE_NUM" --body "$SIGNOFF ran out of budget without opening a PR. Unclaiming." 2>/dev/null || true
        gh issue edit "$ISSUE_NUM" --remove-label "$CLAIM_LABEL" --add-label "agent-ready" 2>/dev/null || true
      fi
    fi
  fi

  task_duration=$(($(date +%s) - task_start))
  report_cost "$ISSUE_NUM" "$task_json" "$task_duration" "task"

  LAST_WORK_TIME=$(date +%s)
  sleep "$POLL_INTERVAL"
done

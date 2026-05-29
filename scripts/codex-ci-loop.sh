#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${REPO_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REPO="voicetreelab/voicetree"
BRANCH="dev"
MAX_ATTEMPTS=10
POLL_INTERVAL=30  # seconds between CI status checks
LOG_FILE="$REPO_DIR/codex-ci-loop.log"

cd "$REPO_DIR"

log() {
  echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG_FILE"
}

get_ci_failure_logs() {
  local run_id="$1"
  gh run view "$run_id" --repo "$REPO" --log-failed 2>&1 | tail -60
}

get_latest_ci_runs() {
  gh api "repos/$REPO/actions/runs?branch=$BRANCH&per_page=5" \
    --jq '.workflow_runs[] | "\(.id) \(.status) \(.conclusion) \(.name)"' 2>&1
}

wait_for_ci() {
  log "Waiting for CI to complete..."
  local max_wait=600  # 10 minutes max wait
  local waited=0

  while [ $waited -lt $max_wait ]; do
    sleep "$POLL_INTERVAL"
    waited=$((waited + POLL_INTERVAL))

    local in_progress
    in_progress=$(gh api "repos/$REPO/actions/runs?branch=$BRANCH&per_page=10" \
      --jq '[.workflow_runs[] | select(.status == "in_progress" or .status == "queued")] | length' 2>&1)

    if [ "$in_progress" = "0" ]; then
      log "All CI runs completed after ${waited}s"
      return 0
    fi
    log "  Still running ($in_progress jobs in progress/queued)... waited ${waited}s"
  done

  log "WARNING: CI still running after ${max_wait}s, proceeding anyway"
  return 1
}

check_ci_green() {
  local failures
  failures=$(gh api "repos/$REPO/actions/runs?branch=$BRANCH&per_page=10" \
    --jq '[.workflow_runs[:5] | .[] | select(.conclusion == "failure")] | length' 2>&1)

  if [ "$failures" = "0" ]; then
    return 0
  else
    return 1
  fi
}

get_failure_summary() {
  local failed_runs
  failed_runs=$(gh api "repos/$REPO/actions/runs?branch=$BRANCH&per_page=10" \
    --jq '.workflow_runs[:5] | .[] | select(.conclusion == "failure") | .id' 2>&1)

  local summary=""
  for run_id in $failed_runs; do
    local run_name
    run_name=$(gh api "repos/$REPO/actions/runs/$run_id" --jq '.name' 2>&1)
    summary+="=== FAILED: $run_name (run $run_id) ===\n"
    summary+="$(get_ci_failure_logs "$run_id")\n\n"
  done
  echo -e "$summary"
}

run_codex_fix() {
  local attempt="$1"
  local error_context="$2"

  local prompt="You are fixing CI/CD failures in a TypeScript monorepo (Electron + Vite).

REPO: $REPO_DIR
BRANCH: $BRANCH
ATTEMPT: $attempt of $MAX_ATTEMPTS

CI FAILURE LOGS:
$error_context

INSTRUCTIONS:
1. Read the error logs above carefully
2. Identify the root cause of the CI failure
3. Fix the code - make minimal, targeted changes
4. Run 'npm run test' locally to verify your fix works
5. Do NOT commit or push - I will handle that

IMPORTANT:
- This is a monorepo with packages in packages/ and webapp/
- Build uses electron-vite
- Follow functional design patterns (see CLAUDE.md)
- Make minimal changes - fix only what's broken"

  log "Running codex exec (attempt $attempt)..."
  codex exec \
    --full-auto \
    -C "$REPO_DIR" \
    -m o3 \
    "$prompt" 2>&1 | tee -a "$LOG_FILE"
}

# --- MAIN LOOP ---

log "========================================="
log "Starting codex CI fix loop"
log "Repo: $REPO"
log "Branch: $BRANCH"
log "Max attempts: $MAX_ATTEMPTS"
log "========================================="

for attempt in $(seq 1 "$MAX_ATTEMPTS"); do
  log ""
  log "--- ATTEMPT $attempt/$MAX_ATTEMPTS ---"

  # Step 1: Check if CI is already green
  if check_ci_green; then
    log "CI is already green! Checking if we need to push..."
    local_ahead=$(git rev-list --count "origin/$BRANCH..$BRANCH" 2>/dev/null || echo "0")
    if [ "$local_ahead" = "0" ]; then
      log "SUCCESS: CI is green and branch is up to date!"
      exit 0
    fi
    log "Branch is $local_ahead commits ahead, pushing..."
    git push origin "$BRANCH" 2>&1 | tee -a "$LOG_FILE"
    wait_for_ci || true
    if check_ci_green; then
      log "SUCCESS: Pushed and CI is green!"
      exit 0
    fi
  fi

  # Step 2: Get failure details
  log "Getting CI failure details..."
  error_context=$(get_failure_summary)

  if [ -z "$error_context" ]; then
    log "No failure logs found. Trying to push and trigger CI..."
    git add -A
    git diff --cached --quiet || git commit -m "ci: fix attempt $attempt

Co-Authored-By: Codex <noreply@openai.com>"
    git push origin "$BRANCH" 2>&1 | tee -a "$LOG_FILE" || {
      log "Push failed, checking for pre-push hook failures..."
      error_context="git push failed. Check pre-push hook output above. The pre-push hook runs local tests."
    }
  fi

  # Step 3: Run codex to fix
  run_codex_fix "$attempt" "$error_context"

  # Step 4: Check if codex made changes
  if git diff --quiet && git diff --cached --quiet; then
    log "Codex made no changes. Retrying with different context..."
    continue
  fi

  # Step 5: Commit changes
  log "Committing codex changes..."
  git add -A
  git commit -m "ci: automated fix attempt $attempt

Co-Authored-By: Codex <noreply@openai.com>" 2>&1 | tee -a "$LOG_FILE"

  # Step 6: Push
  log "Pushing to origin/$BRANCH..."
  if ! git push origin "$BRANCH" 2>&1 | tee -a "$LOG_FILE"; then
    log "Push failed (pre-push hook?). Will retry next iteration."
    continue
  fi

  # Step 7: Wait for CI
  wait_for_ci || true

  # Step 8: Check CI status
  if check_ci_green; then
    log ""
    log "========================================="
    log "SUCCESS! CI is green after attempt $attempt"
    log "========================================="
    exit 0
  fi

  log "CI still failing after attempt $attempt. Looping..."
done

log ""
log "========================================="
log "FAILED: Could not fix CI after $MAX_ATTEMPTS attempts"
log "========================================="
exit 1

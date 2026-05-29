#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$SCRIPT_DIR/test-project-bf201"
TERMINAL_DIR="$PROJECT_DIR/.voicetree/terminals"
RUN_LOG="$SCRIPT_DIR/RUN_LOG.md"
RESULTS_JSON="$SCRIPT_DIR/RESULTS.json"
TMP_DIR="$SCRIPT_DIR/.bf201-tmp"

mkdir -p "$TERMINAL_DIR" "$TMP_DIR"
rm -rf "$TERMINAL_DIR"
mkdir -p "$TERMINAL_DIR"
: > "$RUN_LOG"

ORIGINAL_PATH="$PATH"
CLAUDE_SUBSTITUTION="no"
if command -v claude >/dev/null 2>&1; then
  CLAUDE_VERSION="$(claude --version 2>&1 | head -n 1)"
else
  CLAUDE_SUBSTITUTION="yes"
  mkdir -p "$TMP_DIR/bin"
  cat > "$TMP_DIR/bin/claude" <<'SH'
#!/usr/bin/env bash
if [[ "${1-}" == "--version" ]]; then
  echo "claude-missing; deterministic bash stand-in"
elif [[ "${1-}" == "--print" ]]; then
  shift
  printf 'stand-in claude --print: %s\n' "$*"
else
  while IFS= read -r line; do
    printf 'got: %s\n' "$line"
  done
fi
SH
  chmod +x "$TMP_DIR/bin/claude"
  export PATH="$TMP_DIR/bin:$PATH"
  CLAUDE_VERSION="$(claude --version 2>&1 | head -n 1)"
fi

VAL_3_1='{"verdict":"FAIL","notes":"not run"}'
VAL_3_2='{"verdict":"FAIL","notes":"not run"}'
VAL_3_3='{"verdict":"FAIL","notes":"not run"}'
VAL_3_4='{"verdict":"FAIL","notes":"not run"}'
VAL_3_5='{"verdict":"FAIL","notes":"not run"}'
CRASH_4_1='{"verdict":"FAIL","notes":"not run"}'
CRASH_4_2='{"verdict":"FAIL","notes":"not run"}'
CRASH_4_3='{"verdict":"FAIL","notes":"not run"}'
PERF_5_1_MS=0
PERF_5_2_MS=0
PERF_5_3_MS=0
PERF_5_4_MS=0
PERF_5_5_MS=0

cleanup() {
  for session in vt-Rex vt-RexExit vt-SpikeLag Spike-Send Spike-List-1 Spike-List-2 Spike-List-3 Spike-List-4 Spike-List-5 Spike-List-6 Spike-List-7 Spike-List-8 Spike-List-9 Spike-List-10; do
    tmux has-session -t "$session" 2>/dev/null && tmux kill-session -t "$session" 2>/dev/null
  done
  while IFS=: read -r session _; do
    [[ "$session" == Spike-Cold-* ]] && tmux kill-session -t "$session" 2>/dev/null
  done < <(tmux list-sessions 2>/dev/null || true)
  export PATH="$ORIGINAL_PATH"
}
trap cleanup EXIT

json_escape() {
  local value="${1-}"
  value="${value//\\/\\\\}"
  value="${value//\"/\\\"}"
  value="${value//$'\n'/\\n}"
  value="${value//$'\r'/\\r}"
  value="${value//$'\t'/\\t}"
  printf '%s' "$value"
}

result_object() {
  local verdict="$1"
  local notes="$2"
  printf '{"verdict":"%s","notes":"%s"}' "$(json_escape "$verdict")" "$(json_escape "$notes")"
}

now_ms() {
  perl -MTime::HiRes=time -e 'printf "%.0f\n", time() * 1000'
}

mtime_ms() {
  perl -MTime::HiRes=stat -e 'printf "%.0f\n", (stat($ARGV[0]))[9] * 1000' "$1"
}

median() {
  printf '%s\n' "$@" | sort -n | awk 'NR==3 { print $1 }'
}

append_test() {
  local id="$1"
  local verdict="$2"
  local command="$3"
  local expected="$4"
  local actual="$5"

  {
    printf '\n## %s\n\n' "$id"
    printf 'Verdict: %s\n\n' "$verdict"
    printf 'Command:\n\n```bash\n%s\n```\n\n' "$command"
    printf 'Expected:\n\n```text\n%s\n```\n\n' "$expected"
    printf 'Actual:\n\n```text\n%s\n```\n' "$actual"
  } >> "$RUN_LOG"
}

wait_for_file_text() {
  local file="$1"
  local text="$2"
  local deadline_ms="$3"
  local start_ms
  start_ms="$(now_ms)"

  while (( "$(now_ms)" - start_ms < deadline_ms )); do
    if [[ -f "$file" ]] && grep -Fq "$text" "$file"; then
      return 0
    fi
    sleep 0.05
  done
  return 1
}

wait_for_nonempty_file() {
  local file="$1"
  local deadline_ms="$2"
  local start_ms
  start_ms="$(now_ms)"

  while (( "$(now_ms)" - start_ms < deadline_ms )); do
    [[ -s "$file" ]] && return 0
    sleep 0.05
  done
  return 1
}

wait_for_session_absent() {
  local session="$1"
  local deadline_ms="$2"
  local start_ms
  start_ms="$(now_ms)"

  while (( "$(now_ms)" - start_ms < deadline_ms )); do
    if ! tmux has-session -t "$session" 2>/dev/null; then
      return 0
    fi
    sleep 0.05
  done
  return 1
}

write_results() {
  cat > "$RESULTS_JSON" <<JSON
{
  "val_3_1": $VAL_3_1,
  "val_3_2": $VAL_3_2,
  "val_3_3": $VAL_3_3,
  "val_3_4": $VAL_3_4,
  "val_3_5": $VAL_3_5,
  "crash_4_1": $CRASH_4_1,
  "crash_4_2": $CRASH_4_2,
  "crash_4_3": $CRASH_4_3,
  "perf_5_1_ms": $PERF_5_1_MS,
  "perf_5_2_ms": $PERF_5_2_MS,
  "perf_5_3_ms": $PERF_5_3_MS,
  "perf_5_4_ms": $PERF_5_4_MS,
  "perf_5_5_ms": $PERF_5_5_MS,
  "claude_version": "$(json_escape "$CLAUDE_VERSION")"
}
JSON
}

run_validation_tests() {
  local output
  local actual
  local command

  cleanup
  rm -rf "$TERMINAL_DIR"
  mkdir -p "$TERMINAL_DIR"

  command='PROJECT_DIR="$PWD/test-project-bf201" ./spawn-agent.sh Rex'
  output="$(cd "$SCRIPT_DIR" && PROJECT_DIR="$PROJECT_DIR" ./spawn-agent.sh Rex 2>&1)"
  if [[ -f "$TERMINAL_DIR/Rex.json" ]] && tmux has-session -t vt-Rex 2>/dev/null && wait_for_nonempty_file "$TERMINAL_DIR/Rex.log" 2000; then
    VAL_3_1="$(result_object PASS "metadata exists, vt-Rex is present, Rex.log became non-empty")"
    verdict="PASS"
  else
    VAL_3_1="$(result_object FAIL "metadata/session/log assertion failed; phase-1 session name is vt-Rex")"
    verdict="FAIL"
  fi
  actual="$output"$'\n'"metadata: $(ls "$TERMINAL_DIR"/Rex.json 2>/dev/null || true)"$'\n'"session vt-Rex: $(tmux has-session -t vt-Rex 2>/dev/null; echo $?)"$'\n'"log bytes: $(wc -c < "$TERMINAL_DIR/Rex.log" 2>/dev/null || echo 0)"
  append_test "3.1 spawn writes metadata, tmux session, non-empty log" "$verdict" "$command" "Rex.json exists; tmux has-session vt-Rex returns 0; Rex.log non-empty within 2s" "$actual"

  command='PROJECT_DIR="$PWD/test-project-bf201" ./send-message.sh Rex "say hello"'
  output="$(cd "$SCRIPT_DIR" && PROJECT_DIR="$PROJECT_DIR" ./send-message.sh Rex "say hello" 2>&1)"
  if wait_for_file_text "$TERMINAL_DIR/Rex.log" "say hello" 5000; then
    VAL_3_2="$(result_object PASS "Rex.log contains sent message text")"
    verdict="PASS"
  else
    VAL_3_2="$(result_object FAIL "Rex.log did not contain sent message text within 5s")"
    verdict="FAIL"
  fi
  actual="$output"$'\n'"$(tail -n 12 "$TERMINAL_DIR/Rex.log" 2>/dev/null || true)"
  append_test "3.2 send-message records message text" "$verdict" "$command" "Rex.log contains: say hello" "$actual"

  command='PROJECT_DIR="$PWD/test-project-bf201" ./list-agents.sh; tmux list-sessions | grep "^vt-Rex:"'
  local list_output
  local metadata_present_count
  local tmux_present_count
  list_output="$(cd "$SCRIPT_DIR" && PROJECT_DIR="$PROJECT_DIR" ./list-agents.sh 2>&1)"
  metadata_present_count="$(printf '%s\n' "$list_output" | awk 'NR > 1 && $3 == "present" { count++ } END { print count + 0 }')"
  tmux_present_count="$(tmux list-sessions 2>/dev/null | grep -c '^vt-Rex:' || true)"
  if [[ "$metadata_present_count" == "$tmux_present_count" ]]; then
    VAL_3_3="$(result_object PASS "list-agents present rows match vt-Rex tmux session count")"
    verdict="PASS"
  else
    VAL_3_3="$(result_object FAIL "list-agents present rows=$metadata_present_count but vt-Rex tmux count=$tmux_present_count")"
    verdict="FAIL"
  fi
  actual="$list_output"$'\n'"vt-Rex tmux count: $tmux_present_count"
  append_test "3.3 list-agents matches tmux session count" "$verdict" "$command" "present rows in list-agents match matching tmux sessions" "$actual"

  command='PROJECT_DIR="$PWD/test-project-bf201" ./kill-agent.sh Rex'
  output="$(cd "$SCRIPT_DIR" && PROJECT_DIR="$PROJECT_DIR" ./kill-agent.sh Rex 2>&1)"
  if ! tmux has-session -t vt-Rex 2>/dev/null && grep -Fq '"status":"exited"' "$TERMINAL_DIR/Rex.json"; then
    VAL_3_4="$(result_object PASS "vt-Rex absent and Rex.json status is exited")"
    verdict="PASS"
  else
    VAL_3_4="$(result_object FAIL "kill did not remove vt-Rex or flip metadata status")"
    verdict="FAIL"
  fi
  actual="$output"$'\n'"session vt-Rex: $(tmux has-session -t vt-Rex 2>/dev/null; echo $?)"$'\n'"metadata: $(cat "$TERMINAL_DIR/Rex.json" 2>/dev/null || true)"
  append_test "3.4 kill-agent removes session and flips metadata" "$verdict" "$command" "tmux has-session vt-Rex returns non-zero; Rex.json has status exited" "$actual"

  command='PROJECT_DIR="$PWD/test-project-bf201" ./spawn-agent.sh RexExit hi'
  local start_ms
  local end_ms
  start_ms="$(now_ms)"
  output="$(cd "$SCRIPT_DIR" && PROJECT_DIR="$PROJECT_DIR" ./spawn-agent.sh RexExit hi 2>&1)"
  if wait_for_session_absent vt-RexExit 10000; then
    end_ms="$(now_ms)"
    local latency=$(( end_ms - start_ms ))
    VAL_3_5="$(result_object PASS "natural exit observed after ${latency}ms")"
    verdict="PASS"
  else
    end_ms="$(now_ms)"
    local latency=$(( end_ms - start_ms ))
    VAL_3_5="$(result_object FAIL "vt-RexExit still present after ${latency}ms")"
    verdict="FAIL"
  fi
  actual="$output"$'\n'"latency_ms: $latency"$'\n'"log: $(cat "$TERMINAL_DIR/RexExit.log" 2>/dev/null || true)"
  append_test "3.5 natural exit for claude --print spawn" "$verdict" "$command" "session disappears after claude --print exits; latency recorded" "$actual"
}

run_crash_tests() {
  local output
  local actual
  local command
  local subpid

  cleanup
  rm -rf "$TERMINAL_DIR"
  mkdir -p "$TERMINAL_DIR"

  command='(PROJECT_DIR="$PWD/test-project-bf201" ./spawn-agent.sh Rex; sleep 60) & kill $subshell_pid'
  (
    cd "$SCRIPT_DIR" || exit 1
    PROJECT_DIR="$PROJECT_DIR" ./spawn-agent.sh Rex
    sleep 60
  ) > "$TMP_DIR/crash-subprocess.out" 2>&1 &
  subpid=$!
  for _ in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
    tmux has-session -t vt-Rex 2>/dev/null && break
    sleep 0.1
  done
  tmux send-keys -t vt-Rex "echo crash-preserved" C-m 2>/dev/null || true
  wait_for_file_text "$TERMINAL_DIR/Rex.log" "crash-preserved" 2000 || true
  kill "$subpid" 2>/dev/null || true
  wait "$subpid" 2>/dev/null || true
  if tmux has-session -t vt-Rex 2>/dev/null; then
    CRASH_4_1="$(result_object PASS "killing spawn subshell did not kill vt-Rex")"
    verdict="PASS"
  else
    CRASH_4_1="$(result_object FAIL "vt-Rex disappeared after killing spawn subshell")"
    verdict="FAIL"
  fi
  actual="$(cat "$TMP_DIR/crash-subprocess.out" 2>/dev/null || true)"$'\n'"subshell_pid: $subpid"$'\n'"session vt-Rex: $(tmux has-session -t vt-Rex 2>/dev/null; echo $?)"
  append_test "4.1 tmux session survives parent shell death" "$verdict" "$command" "tmux list-sessions still shows vt-Rex after subshell PID is killed" "$actual"

  command='tmux capture-pane -t vt-Rex -p'
  output="$(tmux capture-pane -t vt-Rex -p 2>&1 || true)"
  if printf '%s\n' "$output" | grep -Fq "crash-preserved"; then
    CRASH_4_2="$(result_object PASS "capture-pane preserved prior output")"
    verdict="PASS"
  else
    CRASH_4_2="$(result_object FAIL "capture-pane did not include crash-preserved output")"
    verdict="FAIL"
  fi
  append_test "4.2 capture-pane preserves prior output" "$verdict" "$command" "captured pane includes crash-preserved" "$output"

  command='printf "$$" > test-project-bf201/.voicetree/relay.pid; PROJECT_DIR="$PWD/test-project-bf201" ./send-message.sh Rex "echo relay-ok"'
  printf '%s\n' "$$" > "$PROJECT_DIR/.voicetree/relay.pid"
  output="$(cd "$SCRIPT_DIR" && PROJECT_DIR="$PROJECT_DIR" ./send-message.sh Rex "echo relay-ok" 2>&1)"
  if wait_for_file_text "$TERMINAL_DIR/Rex.log" "relay-ok" 5000; then
    CRASH_4_3="$(result_object PASS "fresh relay.pid did not prevent new-shell send-message; log contains relay-ok")"
    verdict="PASS"
  else
    CRASH_4_3="$(result_object FAIL "log did not contain relay-ok after new-shell send-message")"
    verdict="FAIL"
  fi
  actual="$output"$'\n'"relay.pid: $(cat "$PROJECT_DIR/.voicetree/relay.pid" 2>/dev/null || true)"$'\n'"$(tail -n 14 "$TERMINAL_DIR/Rex.log" 2>/dev/null || true)"
  append_test "4.3 new shell send-message after fresh relay.pid" "$verdict" "$command" "agent receives and acts on relay-ok message" "$actual"
}

run_perf_tests() {
  local values=()
  local i
  local start_ms
  local end_ms
  local session
  local command
  local actual

  cleanup

  values=()
  for i in 1 2 3 4 5; do
    session="Spike-Cold-$i"
    start_ms="$(now_ms)"
    tmux new-session -d -s "$session" 'sleep 60'
    end_ms="$(now_ms)"
    values+=( $(( end_ms - start_ms )) )
    tmux kill-session -t "$session" 2>/dev/null || true
  done
  PERF_5_1_MS="$(median "${values[@]}")"
  command='for i in 1..5; tmux new-session -d -s Spike-Cold-$i "sleep 60"; tmux kill-session -t Spike-Cold-$i'
  actual="runs_ms: ${values[*]}"$'\n'"median_ms: $PERF_5_1_MS"
  append_test "5.1 tmux new-session cold start median" "PASS" "$command" "median of 5 runs, integer ms" "$actual"

  tmux new-session -d -s Spike-Send 'bash'
  values=()
  for i in 1 2 3 4 5; do
    start_ms="$(now_ms)"
    tmux send-keys -t Spike-Send "echo send-$i" C-m
    end_ms="$(now_ms)"
    values+=( $(( end_ms - start_ms )) )
  done
  PERF_5_2_MS="$(median "${values[@]}")"
  actual="runs_ms: ${values[*]}"$'\n'"median_ms: $PERF_5_2_MS"
  append_test "5.2 tmux send-keys median" "PASS" 'tmux send-keys -t Spike-Send "echo send-$i" C-m' "median of 5 runs, integer ms" "$actual"

  values=()
  for i in 1 2 3 4 5; do
    start_ms="$(now_ms)"
    tmux has-session -t Spike-Send
    end_ms="$(now_ms)"
    values+=( $(( end_ms - start_ms )) )
  done
  PERF_5_3_MS="$(median "${values[@]}")"
  actual="runs_ms: ${values[*]}"$'\n'"median_ms: $PERF_5_3_MS"
  append_test "5.3 tmux has-session median" "PASS" 'tmux has-session -t Spike-Send' "median of 5 runs, integer ms" "$actual"
  tmux kill-session -t Spike-Send 2>/dev/null || true

  for i in 1 2 3 4 5 6 7 8 9 10; do
    tmux new-session -d -s "Spike-List-$i" 'sleep 60'
  done
  values=()
  for i in 1 2 3 4 5; do
    start_ms="$(now_ms)"
    tmux list-sessions >/dev/null
    end_ms="$(now_ms)"
    values+=( $(( end_ms - start_ms )) )
  done
  PERF_5_4_MS="$(median "${values[@]}")"
  actual="concurrent_sessions: 10"$'\n'"runs_ms: ${values[*]}"$'\n'"median_ms: $PERF_5_4_MS"
  append_test "5.4 tmux list-sessions with 10 sessions median" "PASS" 'tmux list-sessions >/dev/null with Spike-List-1..10 running' "median of 5 runs, integer ms" "$actual"
  for i in 1 2 3 4 5 6 7 8 9 10; do
    tmux kill-session -t "Spike-List-$i" 2>/dev/null || true
  done

  rm -rf "$TERMINAL_DIR"
  mkdir -p "$TERMINAL_DIR"
  (cd "$SCRIPT_DIR" && PROJECT_DIR="$PROJECT_DIR" ./spawn-agent.sh SpikeLag >/dev/null 2>&1)
  values=()
  for i in 1 2 3 4 5; do
    local marker="lag-ts-$i:"
    tmux send-keys -t vt-SpikeLag "printf '${marker}%d\n' \"\$(perl -MTime::HiRes=time -e 'printf \"%.0f\", time() * 1000')\"" C-m
    wait_for_file_text "$TERMINAL_DIR/SpikeLag.log" "$marker" 5000 || true
    local emitted
    emitted="$(grep -Eo "${marker}[0-9]+" "$TERMINAL_DIR/SpikeLag.log" | tail -n 1 | sed "s/${marker}//")"
    local modified
    modified="$(mtime_ms "$TERMINAL_DIR/SpikeLag.log")"
    if [[ "$emitted" =~ ^[0-9]+$ && "$modified" =~ ^[0-9]+$ ]]; then
      values+=( $(( modified - emitted )) )
    else
      values+=( 0 )
    fi
    sleep 0.1
  done
  PERF_5_5_MS="$(median "${values[@]}")"
  actual="runs_ms: ${values[*]}"$'\n'"median_ms: $PERF_5_5_MS"$'\n'"log_tail:"$'\n'"$(tail -n 16 "$TERMINAL_DIR/SpikeLag.log" 2>/dev/null || true)"
  append_test "5.5 output lag median" "PASS" "send printf lag-ts-N:<epoch_ms>; compare SpikeLag.log mtime to emitted timestamp" "median of 5 output-lag runs, integer ms" "$actual"
}

{
  printf '# BF-201 tmux Agent Lifecycle Empirical Run\n\n'
  printf '%s\n' "- Run directory: \`$SCRIPT_DIR\`"
  printf '%s\n' "- Project directory: \`$PROJECT_DIR\`"
  printf '%s\n' "- Claude version: \`$CLAUDE_VERSION\`"
  printf '%s\n' "- Claude substitution used: \`$CLAUDE_SUBSTITUTION\`"
  printf '%s\n' '- Note: phase-1 scripts name tmux sessions `vt-AGENT_NAME`, so Rex is observed as `vt-Rex`.'
} >> "$RUN_LOG"

run_validation_tests
run_crash_tests
run_perf_tests
cleanup

leftovers="$(tmux list-sessions 2>/dev/null | grep -E '^(Rex|Spike-|vt-Rex|vt-Spike)' || true)"
if [[ -n "$leftovers" ]]; then
  {
    printf '\n## Cleanup anomaly\n\n'
    printf 'Verdict: FAIL\n\n```text\n%s\n```\n' "$leftovers"
  } >> "$RUN_LOG"
fi

write_results

rm -rf "$TMP_DIR"
printf 'Wrote %s and %s\n' "$RESULTS_JSON" "$RUN_LOG"

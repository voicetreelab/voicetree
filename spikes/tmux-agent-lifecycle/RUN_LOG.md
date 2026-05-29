# BF-201 tmux Agent Lifecycle Empirical Run

- Run directory: `/Users/example/repos/voicetree-public/spike-filesystem-native-agent-lifecycle/.worktrees/wt-spike-filesystem-native-agent--1wx/spikes/tmux-agent-lifecycle`
- Project directory: `/Users/example/repos/voicetree-public/spike-filesystem-native-agent-lifecycle/.worktrees/wt-spike-filesystem-native-agent--1wx/spikes/tmux-agent-lifecycle/test-project-bf201`
- Claude version: `2.1.142 (Claude Code)`
- Claude substitution used: `no`
- Note: phase-1 scripts name tmux sessions `vt-AGENT_NAME`, so Rex is observed as `vt-Rex`.

## 3.1 spawn writes metadata, tmux session, non-empty log

Verdict: PASS

Command:

```bash
PROJECT_DIR="$PWD/test-project-bf201" ./spawn-agent.sh Rex
```

Expected:

```text
Rex.json exists; tmux has-session vt-Rex returns 0; Rex.log non-empty within 2s
```

Actual:

```text
spawned Rex in tmux session vt-Rex
metadata: /Users/example/repos/voicetree-public/spike-filesystem-native-agent-lifecycle/.worktrees/wt-spike-filesystem-native-agent--1wx/spikes/tmux-agent-lifecycle/test-project-bf201/.voicetree/terminals/Rex.json
session vt-Rex: 0
log bytes:       18
```

## 3.2 send-message records message text

Verdict: PASS

Command:

```bash
PROJECT_DIR="$PWD/test-project-bf201" ./send-message.sh Rex "say hello"
```

Expected:

```text
Rex.log contains: say hello
```

Actual:

```text
sent message to Rex
[?2004hbash-5.3$ say hello
[?2004l
```

## 3.3 list-agents matches tmux session count

Verdict: PASS

Command:

```bash
PROJECT_DIR="$PWD/test-project-bf201" ./list-agents.sh; tmux list-sessions | grep "^vt-Rex:"
```

Expected:

```text
present rows in list-agents match matching tmux sessions
```

Actual:

```text
NAME                 STATUS     TMUX       SESSION                  PID
Rex                  running    present    vt-Rex                   46570
vt-Rex tmux count: 1
```

## 3.4 kill-agent removes session and flips metadata

Verdict: PASS

Command:

```bash
PROJECT_DIR="$PWD/test-project-bf201" ./kill-agent.sh Rex
```

Expected:

```text
tmux has-session vt-Rex returns non-zero; Rex.json has status exited
```

Actual:

```text
killed Rex
session vt-Rex: 1
metadata: {"name":"Rex","status":"exited","pid":46570,"session":"vt-Rex","startedAt":"2026-05-15T04:47:53Z","exitedAt":"2026-05-15T04:47:53Z","logFile":"/Users/example/repos/voicetree-public/spike-filesystem-native-agent-lifecycle/.worktrees/wt-spike-filesystem-native-agent--1wx/spikes/tmux-agent-lifecycle/test-project-bf201/.voicetree/terminals/Rex.log"}
```

## 3.5 natural exit for claude --print spawn

Verdict: PASS

Command:

```bash
PROJECT_DIR="$PWD/test-project-bf201" ./spawn-agent.sh RexExit hi
```

Expected:

```text
session disappears after claude --print exits; latency recorded
```

Actual:

```text
spawned RexExit in tmux session vt-RexExit
latency_ms: 2883
log: Hi! What would you like to work on?
[?1006l[?1003l[?1002l[?1000l[>4m[<u[?1004l[?2031l[?2004l[?25h7[r8]0;[?25h
```

## 4.1 tmux session survives parent shell death

Verdict: PASS

Command:

```bash
(PROJECT_DIR="$PWD/test-project-bf201" ./spawn-agent.sh Rex; sleep 60) & kill $subshell_pid
```

Expected:

```text
tmux list-sessions still shows vt-Rex after subshell PID is killed
```

Actual:

```text
spawned Rex in tmux session vt-Rex
subshell_pid: 46931
session vt-Rex: 0
```

## 4.2 capture-pane preserves prior output

Verdict: PASS

Command:

```bash
tmux capture-pane -t vt-Rex -p
```

Expected:

```text
captured pane includes crash-preserved
```

Actual:

```text
bash-5.3$ echo crash-preserved
crash-preserved
bash-5.3$
```

## 4.3 new shell send-message after fresh relay.pid

Verdict: PASS

Command:

```bash
printf "$$" > test-project-bf201/.voicetree/relay.pid; PROJECT_DIR="$PWD/test-project-bf201" ./send-message.sh Rex "echo relay-ok"
```

Expected:

```text
agent receives and acts on relay-ok message
```

Actual:

```text
sent message to Rex
relay.pid: 46513
[?2004hbash-5.3$ echo crash-preserved
[?2004lcrash-preserved
[?2004hbash-5.3$ echo relay-ok
[?2004lrelay-ok
[?2004hbash-5.3$ 
```

## 5.1 tmux new-session cold start median

Verdict: PASS

Command:

```bash
for i in 1..5; tmux new-session -d -s Spike-Cold-$i "sleep 60"; tmux kill-session -t Spike-Cold-$i
```

Expected:

```text
median of 5 runs, integer ms
```

Actual:

```text
runs_ms: 22 21 21 22 22
median_ms: 22
```

## 5.2 tmux send-keys median

Verdict: PASS

Command:

```bash
tmux send-keys -t Spike-Send "echo send-$i" C-m
```

Expected:

```text
median of 5 runs, integer ms
```

Actual:

```text
runs_ms: 12 12 12 13 13
median_ms: 12
```

## 5.3 tmux has-session median

Verdict: PASS

Command:

```bash
tmux has-session -t Spike-Send
```

Expected:

```text
median of 5 runs, integer ms
```

Actual:

```text
runs_ms: 13 12 13 12 14
median_ms: 13
```

## 5.4 tmux list-sessions with 10 sessions median

Verdict: PASS

Command:

```bash
tmux list-sessions >/dev/null with Spike-List-1..10 running
```

Expected:

```text
median of 5 runs, integer ms
```

Actual:

```text
concurrent_sessions: 10
runs_ms: 14 15 15 21 14
median_ms: 15
```

## 5.5 output lag median

Verdict: PASS

Command:

```bash
send printf lag-ts-N:<epoch_ms>; compare SpikeLag.log mtime to emitted timestamp
```

Expected:

```text
median of 5 output-lag runs, integer ms
```

Actual:

```text
runs_ms: 0 0 1 1 1
median_ms: 1
log_tail:
[?2004hbash-5.3$ printf 'lag-ts-1:%d\n' "$(perl -MTime::HiRes=time -e 'printf "%.0f", time() * 1000')"
[?2004llag-ts-1:1778820477344
[?2004hbash-5.3$ printf 'lag-ts-2:%d\n' "$(perl -MTime::HiRes=time -e 'printf "%.0f", time() * 1000')"
[?2004llag-ts-2:1778820477486
[?2004hbash-5.3$ printf 'lag-ts-3:%d\n' "$(perl -MTime::HiRes=time -e 'printf "%.0f", time() * 1000')"
[?2004llag-ts-3:1778820477625
[?2004hbash-5.3$ printf 'lag-ts-4:%d\n' "$(perl -MTime::HiRes=time -e 'printf "%.0f", time() * 1000')"
[?2004llag-ts-4:1778820477765
[?2004hbash-5.3$ printf 'lag-ts-5:%d\n' "$(perl -MTime::HiRes=time -e 'printf "%.0f", time() * 1000')"
[?2004llag-ts-5:1778820477903
[?2004hbash-5.3$ 
```

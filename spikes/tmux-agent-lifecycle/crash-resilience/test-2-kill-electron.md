# BF-314 Test 2: kill Electron

Verdict: BLOCKED IN HEADLESS SANDBOX

Date: 2026-05-15

Required test:
- Spawn 3 tmux-backed agents.
- Kill the Electron process with `kill -9`.
- Assert all 3 tmux sessions stay alive.
- Relaunch Electron and assert panels rebind to the existing sessions.

What was reachable:
- The headless relay crash path was exercised in `test-1-kill-relay.md`; that verifies the tmux session survives the relay process dying and a new relay process can reconnect to the same tmux session.
- The terminal-registry reconciliation path was implemented and tested with one live persisted tmux JSON plus one stale persisted tmux JSON.

What was not reachable:
- Process enumeration and Electron kill were blocked in this Codex sandbox:

```text
pgrep -af "Electron|Voicetree|electron"
sysmon request failed with error: sysmond service not found
pgrep: Cannot get process list

ps -ax -o pid=,comm= | rg -i 'electron|voicetree'
zsh:1: operation not permitted: ps
```

Verdict rationale:
- This is not a product FAIL because the sandbox prevented discovering or killing an Electron PID.
- It remains a manual validation gap: Sam should run the Electron close/relaunch sweep before Phase 6 flips `ptyBackend` to `tmux` by default.


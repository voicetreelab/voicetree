# BF-314 Test 2: kill Electron

Verdict: M1 FAIL - M1-fix3 did not clear Electron tmux-backed spawn; `tmux new-session` still fails with `command too long` before any sessions exist. Phase 6 stays gated.

Date: 2026-05-15
Runner: Aki
Worktree: `wt-spike-filesystem-native-agent--1wx`
Commit tested: `733dedae` (`[M1-fix3] fix: spawnTmuxBacked passes only initialEnvVars (tmux argv overflow)`)

## Summary

`ptyBackend` was set to `tmux` in `/Users/bobbobby/Library/Application Support/Voicetree/settings.json`, backed up to `settings.json.pre-m1-rerun-3-2026-05-15T11-17-58-3NZ`, and restored after cleanup.

Native rebuild passed, and Electron launched headfully with persistent user data and fixed CDP:

```text
VOICETREE_PERSIST_STATE=1 PLAYWRIGHT_MCP_CDP_ENDPOINT=http://localhost:9222 npm --workspace webapp run electron
```

Electron reached a visible window with CDP on `9222` and MCP on `3001`. The renderer confirmed settings as `{ "ptyBackend": "tmux", "agents": 8 }`. Debug auto-setup loaded `example_small` and created three Fake Agent panels: `Aki`, `Ama`, and `Amit`.

The load-bearing pre-kill check still failed. `tmux ls` remained empty, and the main process logged `Failed to spawn tmux-backed terminal Aki: Error: tmux new-session ... failed with exit code 1: command too long`. The visible command line no longer included the full `process.env`, but it still included large `terminalData.initialEnvVars` entries such as `AGENT_PROMPT_LIGHTWEIGHT`, `AGENT_PROMPT_CORE`, `AGENT_PROMPT`, and `AGENT_PROMPT_PREVIOUS_BACKUP`; those prompt payloads are enough to overflow tmux's command buffer.

Per the M1 hard fence, the sweep stopped before sentinels, Electron kill, and relaunch. No production code was changed.

## Step Results

| Step | Result | Evidence |
| --- | --- | --- |
| 1. Set runtime `ptyBackend = "tmux"` | PASS | Settings backup created at `settings.json.pre-m1-rerun-3-2026-05-15T11-17-58-3NZ`. Renderer confirmed `{ "ptyBackend": "tmux", "agents": 8 }`. Settings restored after cleanup. |
| 2. Build natives and launch Electron | PASS | `scripts/rebuild-native.sh` passed. Electron script rebuilt natives again and launched with CDP `9222`, MCP `3001`, and persistent user data. |
| 3. Trigger debug setup | FAIL at spawn backend | Debug auto-setup completed with `{"terminalsSpawned":["Aki","Ama","Amit"],"nodeCount":22,"projectLoaded":".../webapp/public/example_small"}`. UI showed all three panels. Main logged `Failed to spawn tmux-backed terminal Aki: Error: tmux new-session ... failed with exit code 1: command too long`. |
| 4. Verify `tmux ls` before kill | FAIL | At `2026-05-15T11:19:52Z`, `tmux ls` returned `no server running on /private/tmp/tmux-501/default`. This is the load-bearing failure. |
| 5. Emit sentinels | NOT RUN | No tmux sessions existed, so there was no valid shell to receive `echo "sentinel-<n>-pre-kill"`. |
| 6. Capture Electron PID | PASS | Main dev Electron PID during the run: `65698`; electron-vite PID: `65624`; wrapper PID: `65030`. |
| 7. `kill -9 $ELECTRON_PID` | NOT RUN | Stopped before kill because no tmux sessions existed to survive the kill. Dev Electron was stopped during cleanup with Ctrl-C. |
| 8. `tmux ls` between kill and relaunch | NOT RUN | No valid pre-kill sessions existed. |
| 9. Relaunch and observe panel rebind | NOT RUN | No sessions existed to rebind. |

## Timestamps

- Settings override timestamp: 2026-05-15T11:17:58Z
- Electron launch reached DevTools/MCP: 2026-05-15T11:18:25Z
- Debug setup started loading `example_small`: 2026-05-15T11:18:41Z
- Debug setup completed and reported `Aki`, `Ama`, `Amit`: 2026-05-15T11:18:43Z
- Failure observation timestamp: 2026-05-15T11:19:52Z
- Cleanup completed: 2026-05-15T11:20:34Z
- Kill timestamp: not applicable; stopped before kill because no tmux sessions existed.
- Relaunch timestamp: not applicable.
- Observed rebind latency: not applicable.

## Process Evidence

```text
65030 sh -c ../scripts/rebuild-native.sh && electron-vite dev
65624 node .../webapp/node_modules/.bin/electron-vite dev
65698 .../webapp/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .
66140 .../Electron Helper (Renderer) ... --remote-debugging-port=9222 ...
```

After cleanup, no matching Electron/electron-vite process for this worktree remained.

## `tmux ls` Evidence

Baseline before launch:

```text
no server running on /private/tmp/tmux-501/default
```

After debug setup:

```text
2026-05-15T11:19:52Z
no server running on /private/tmp/tmux-501/default
```

After cleanup:

```text
no server running on /private/tmp/tmux-501/default
```

## Panel Text Capture

Captured from the visible Electron renderer via CDP after setup:

```text
TERMINALS
Hover over me
wt-spike-filesystem-native-agent--1wx
Aki - Fake Agent
Generate codebase graph (run me)
wt-spike-filesystem-native-agent--1wx
Ama - Fake Agent
Voicetree
wt-spike-filesystem-native-agent--1wx
Amit - Fake Agent
...
Hover over me
Aki
wt-spike-filesystem-native-agent--1wx
Generate codebase graph (run me)
Ama
wt-spike-filesystem-native-agent--1wx
Voicetree
Amit
wt-spike-filesystem-native-agent--1wx
No nodes in view
Fit to Graph
```

Screenshot captured for audit:

```text
/tmp/m1-rerun-3-1778843788657qnb.png
```

## Main-Process Error Evidence

The Electron main process log showed the same failure class after M1-fix3:

```text
[Startup] Playwright debug auto-setup complete: {"terminalsSpawned":["Aki","Ama","Amit"],"nodeCount":22,"projectLoaded":"/Users/bobbobby/repos/voicetree-public/spike-filesystem-native-agent-lifecycle/.worktrees/wt-spike-filesystem-native-agent--1wx/webapp/public/example_small"}
Failed to spawn tmux-backed terminal Aki: Error: tmux new-session -d -s Aki -e VOICETREE_PROJECT_DIR=... -e VOICETREE_APP_SUPPORT=... -e VOICETREE_VAULT_PATH=... -e ALL_MARKDOWN_READ_PATHS=... -e CONTEXT_NODE_PATH=... -e TASK_NODE_PATH=... -e VOICETREE_TERMINAL_ID=Aki -e VOICETREE_CALLER_TERMINAL_ID=Aki -e AGENT_NAME=Aki -e VOICETREE_MCP_PORT=3001 -e AGENT_PROMPT_LIGHTWEIGHT=... -e AGENT_PROMPT_CORE=... -e AGENT_PROMPT=... -e DEPTH_BUDGET=10 -e AGENT_PROMPT_PREVIOUS_BACKUP=... cd '.../webapp/public/example_small/' && /bin/zsh failed with exit code 1: command too long
```

M1-fix3 removed the full `process.env` fan-out, but `terminalData.initialEnvVars` is not small in this Electron debug setup because it carries multiple long prompt strings. `tmux-session-manager.createSession()` still passes every env entry through `tmux new-session -e KEY=VALUE`, so long prompt-valued entries can still trip tmux's command buffer even when the entry count is modest.

## Load-Bearing Finding

M1-fix3 changed the env source but did not remove the underlying tmux argv-size risk:

```text
TerminalVanilla.initTerminal()
  settings.ptyBackend === "tmux"
  -> initRelayTerminal()
  -> window.electronAPI.terminal.spawn(terminalData)
  -> ipc-terminal-handlers terminal:spawn tmux branch
  -> terminalManager.spawnTmuxBacked()
  -> tmuxEnv = {...terminalData.initialEnvVars}
  -> spawnTmuxBackedTerminal()
  -> createSession()
  -> tmux new-session -e AGENT_PROMPT_* ...
  -> tmux exits 1: command too long
  -> tmux ls remains empty
```

Phase 6 default-flip remains blocked until Electron tmux-mode panels can create at least three backing tmux sessions before kill/relaunch. The next likely fix should avoid putting large prompt payloads directly into `tmux new-session` argv, for example by using a small env-file/bootstrap indirection or by setting prompt environment inside the spawned shell rather than with tmux `-e`.

## Calibration Claim

Claim (HIGH ~0.9): Phase 6 remains blocked by tmux-backed session creation from Electron. M1-fix3's "only initialEnvVars" approach is insufficient because the debug agent prompt values inside `initialEnvVars` are themselves large enough to reproduce the `command too long` failure.

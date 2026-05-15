# BF-314 Test 2: kill Electron

Verdict: M1 FAIL - renderer tmux panels still never create backing tmux sessions; the M1-fix IPC handler is bypassed by `TerminalVanilla.initRelayTerminal`, so the kill/relaunch sweep cannot proceed. Phase 6 stays gated.

Date: 2026-05-15
Runner: Yan
Worktree: `wt-spike-filesystem-native-agent--1wx`
Commit tested: `fac86efc` (`[M1-fix] feat: ipc-terminal-handlers creates tmux session before WS attach`)

## Summary

`ptyBackend` was set to `tmux` in `/Users/bobbobby/Library/Application Support/Voicetree/settings.json`, backed up to `settings.json.pre-m1-rerun-2026-05-15T10-52-08-3NZ`, and restored after cleanup.

Electron was launched headfully with:

```text
VOICETREE_PERSIST_STATE=1 npm --workspace webapp run electron
```

Native rebuild passed and Electron reached a visible window with CDP on port 9222. Debug auto-setup created the first three Fake Agent panels (`Aki`, `Ama`, `Amit`) at 2026-05-15T10:52:43Z. Because `tmux ls` was empty, I invoked `window.electronAPI.main.prettySetupAppForElectronDebugging()` manually to create three fresh panels (`Amy`, `Anna`, `Ari`) after confirming the running app had loaded `ptyBackend: "tmux"`.

The fresh panels also remained in `tmux reconnecting`, and `tmux ls` still returned no server. This means the M1-fix did not close the Electron path: `webapp/src/shell/UI/floating-windows/terminals/TerminalVanilla.ts` routes `ptyBackend === "tmux"` directly to `initRelayTerminal()`, which connects to `ws://localhost:{mcpPort}/terminals/{terminalId}/attach` and never calls `window.electronAPI.terminal.spawn(...)`. Therefore the fixed `terminal:spawn` IPC branch in `webapp/src/shell/edge/main/agent/terminals/ipc-terminal-handlers.ts` is not reached.

Per the M1 hard fence, the sweep stopped at the load-bearing pre-kill check. No production code was changed.

## Step Results

| Step | Result | Evidence |
| --- | --- | --- |
| 1. Set runtime `ptyBackend = "tmux"` | PASS | Running renderer confirmed `window.electronAPI.main.loadSettings()` returned `{ "ptyBackend": "tmux", "agents": 8 }`. Settings backup was restored after cleanup. |
| 2. Build natives and launch Electron | PASS | `scripts/rebuild-native.sh` passed before launch. `npm --workspace webapp run electron` also rebuilt natives and launched Electron. DevTools listened on `ws://127.0.0.1:9222/...`; MCP server ran on `http://localhost:3001/mcp`. |
| 3. Spawn 3 agents and emit sentinels | FAIL | Debug auto-setup spawned `Aki`, `Ama`, `Amit`; manual rerun spawned fresh `Amy`, `Anna`, `Ari`. All six panels displayed `tmux reconnecting`; no shell prompt appeared, so no sentinel could be emitted. |
| 4. Verify `tmux ls` before kill | FAIL | `tmux ls` returned `no server running on /private/tmp/tmux-501/default` after both automatic and manual fresh spawns. This is the load-bearing failure. |
| 5. Capture Electron PID | PASS | Main dev Electron PID: `30610`. |
| 6. `kill -9 $ELECTRON_PID` | NOT RUN | Stopped before kill because no tmux sessions existed to survive the kill. Dev process was stopped during cleanup with Ctrl-C instead. |
| 7. `tmux ls` between kill and relaunch | NOT RUN | No valid pre-kill sessions existed. |
| 8. Relaunch and observe panel rebind | NOT RUN | No sessions existed to rebind. |
| 9. Optional CLI attach | NOT RUN | No tmux target existed. |

## Timestamps

- Settings override timestamp: 2026-05-15T10:52:08Z
- Electron launch reached DevTools/MCP: 2026-05-15T10:52:26Z
- Debug auto-setup created `Aki`, `Ama`, `Amit`: 2026-05-15T10:52:43Z
- Manual fresh spawn created `Amy`, `Anna`, `Ari`: 2026-05-15T10:54:26Z
- Failure observation timestamp: 2026-05-15T10:55:43Z
- Kill timestamp: not applicable; stopped before kill because no tmux sessions existed.
- Relaunch timestamp: not applicable.
- Observed rebind latency: not applicable.
- Cleanup: dev Electron process stopped, settings backup restored, and no tmux sessions needed killing.

## Process Evidence

```text
30610 /Users/bobbobby/repos/voicetree-public/spike-filesystem-native-agent-lifecycle/.worktrees/wt-spike-filesystem-native-agent--1wx/webapp/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .
```

## `tmux ls` Evidence

After automatic debug setup:

```text
no server running on /private/tmp/tmux-501/default
```

After manual fresh spawn of `Amy`, `Anna`, `Ari`:

```text
no server running on /private/tmp/tmux-501/default
```

## Panel Text Capture

Captured from the visible Electron renderer via CDP after the manual fresh spawn:

```text
TERMINALS
Hover over me
... Aki - Fake Agent
Generate codebase graph (run me)
... Ama - Fake Agent
Voicetree
... Amit - Fake Agent
Hover over me
... Amy - Fake Agent
Generate codebase graph (run me)
... Anna - Fake Agent
Voicetree
... Ari - Fake Agent
...
Hover over me
Aki
tmux reconnecting
Generate codebase graph (run me)
Ama
tmux reconnecting
Voicetree
Amit
tmux reconnecting
Hover over me
Amy
tmux reconnecting
Generate codebase graph (run me)
Anna
tmux reconnecting
Voicetree
Ari
tmux reconnecting
```

Screenshot captured for audit:

```text
/tmp/vt-debug/screenshots/1778842557075.png
```

## Renderer Exception Evidence

The renderer also logged reconnect-loop exceptions while the panels failed to attach:

```text
Uncaught TypeError: Illegal invocation
    at TerminalRelayClient.scheduleReconnect (terminalRelayClient.ts:86:32)
    at WebSocket.<anonymous> (terminalRelayClient.ts:61:12)
```

This is secondary evidence. The primary M1 gate failure is still the empty `tmux ls` after fresh panel spawn.

## Load-Bearing Finding

The M1-fix added session creation inside the `terminal:spawn` IPC handler, but the renderer does not call that IPC handler in tmux mode:

```text
TerminalVanilla.initTerminal()
  settings.ptyBackend === "tmux"
  -> initRelayTerminal()
  -> WebSocket attach to relay
  -> no window.electronAPI.terminal.spawn(...)
```

That explains why both Wei's original run and this `fac86efc` rerun show identical `tmux reconnecting` behavior with no tmux server.

## Calibration Claim

Claim (HIGH ~0.9): Phase 6 default-flip will remain blocked until the renderer tmux path creates/imports the backing tmux session before relay attach, or tmux-mode spawning is moved back through an IPC/API path that calls `TerminalManager.spawnTmuxBacked`. Falsifier: a fresh Electron tmux-mode panel creates a tmux session visible in `tmux ls` without changing `TerminalVanilla.initRelayTerminal`.

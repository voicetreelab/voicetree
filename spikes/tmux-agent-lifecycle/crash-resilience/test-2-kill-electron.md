# BF-314 Test 2: kill Electron

Verdict: M1 FAIL - renderer now reaches `terminal:spawn`, but tmux-backed spawn fails before creating sessions. Phase 6 stays gated.

Date: 2026-05-15
Runner: Zoe
Worktree: `wt-spike-filesystem-native-agent--1wx`
Commit tested: `8eb72a89` (`[M1-fix2] feat: renderer tmux path calls IPC spawn before WS attach`)

## Summary

`ptyBackend` was set to `tmux` in `/Users/bobbobby/Library/Application Support/Voicetree/settings.json`, backed up to `settings.json.pre-m1-rerun-2-2026-05-15T11-02-44-3NZ`, and restored after cleanup.

Electron was launched headfully with:

```text
VOICETREE_PERSIST_STATE=1 npm --workspace webapp run electron
```

Native rebuild passed before launch and again through the Electron script. Electron reached a visible window with CDP on port 9222 and MCP on port 3001. `window.electronAPI.main.loadSettings()` confirmed the running renderer saw `{ "ptyBackend": "tmux", "agents": 8 }`.

I triggered `window.electronAPI.main.prettySetupAppForElectronDebugging()`. The automatic setup spawned `Aki`, `Ama`, `Amit`, and a manual second invocation spawned `Amy`, `Anna`, `Ari`. This time the renderer did call the tmux IPC path, but the main process logged `Failed to spawn tmux-backed terminal Aki: Error: tmux new-session ... failed with exit code 1`. `tmux ls` remained empty, so no sentinel could be emitted and the kill/relaunch portion was not valid to run.

Per the M1 hard fence, the sweep stopped at the load-bearing pre-kill check. No production code was changed.

## Step Results

| Step | Result | Evidence |
| --- | --- | --- |
| 1. Set runtime `ptyBackend = "tmux"` | PASS | Settings backup created at `settings.json.pre-m1-rerun-2-2026-05-15T11-02-44-3NZ`. Renderer confirmed `{ "ptyBackend": "tmux", "agents": 8 }`. Settings restored after cleanup. |
| 2. Build natives and launch Electron | PASS | `scripts/rebuild-native.sh` passed. `VOICETREE_PERSIST_STATE=1 npm --workspace webapp run electron` rebuilt natives and launched Electron. DevTools listened on `ws://127.0.0.1:9222/...`; MCP server ran on `http://localhost:3001/mcp`. |
| 3. Trigger debug setup | FAIL at spawn backend | `prettySetupAppForElectronDebugging()` returned `done` and UI showed six Fake Agent panels (`Aki`, `Ama`, `Amit`, `Amy`, `Anna`, `Ari`), but main logged `Failed to spawn tmux-backed terminal Aki: Error: tmux new-session ... failed with exit code 1`. |
| 4. Verify `tmux ls` before kill | FAIL | `tmux ls` returned `no server running on /private/tmp/tmux-501/default` after setup. This is the load-bearing failure. |
| 5. Emit sentinels | NOT RUN | No tmux sessions existed and the xterm panels had no shell prompt, so there was nowhere to type `echo "sentinel-<n>-pre-kill"`. |
| 6. Capture Electron PID | PASS | Main dev Electron PID during the run: `44681`. |
| 7. `kill -9 $ELECTRON_PID` | NOT RUN | Stopped before kill because no tmux sessions existed to survive the kill. Dev Electron was stopped during cleanup. |
| 8. `tmux ls` between kill and relaunch | NOT RUN | No valid pre-kill sessions existed. |
| 9. Relaunch and observe panel rebind | NOT RUN | No sessions existed to rebind. |

## Timestamps

- Settings override timestamp: 2026-05-15T11:02:44Z
- Electron launch reached DevTools/MCP: 2026-05-15T11:03:18Z
- Debug setup started and loaded `example_small`: 2026-05-15T11:03:34Z
- Automatic debug setup created `Aki`, `Ama`, `Amit`: 2026-05-15T11:03:35Z
- Manual setup invocation completed and UI showed `Amy`, `Anna`, `Ari`: 2026-05-15T11:04:21Z
- Failure observation timestamp: 2026-05-15T11:04:21Z
- Cleanup completed: 2026-05-15T11:07:24Z
- Kill timestamp: not applicable; stopped before kill because no tmux sessions existed.
- Relaunch timestamp: not applicable.
- Observed rebind latency: not applicable.

## Process Evidence

```text
44016 sh -c ../scripts/rebuild-native.sh && electron-vite dev
44642 node .../webapp/node_modules/.bin/electron-vite dev
44681 .../webapp/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .
45089 .../Electron Helper (Renderer) ... --remote-debugging-port=9222 ...
```

After cleanup, no matching Electron/electron-vite process for this worktree remained.

## `tmux ls` Evidence

Baseline before launch:

```text
no server running on /private/tmp/tmux-501/default
```

After debug setup:

```text
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
Generate codebase graph (run me)
Ama
Voicetree
Amit
Hover over me
Amy
Generate codebase graph (run me)
Anna
Voicetree
Ari
```

Screenshot captured for audit:

```text
/tmp/vt-debug/screenshots/m1-rerun-2-17788428957964bc.png
```

## Main-Process Error Evidence

The Electron main process log showed the new failure class:

```text
[Startup] Playwright debug auto-setup complete: {"terminalsSpawned":["Aki","Ama","Amit"],"nodeCount":16,"projectLoaded":"/Users/bobbobby/repos/voicetree-public/spike-filesystem-native-agent-lifecycle/.worktrees/wt-spike-filesystem-native-agent--1wx/webapp/public/example_small"}
Failed to spawn tmux-backed terminal Aki: Error: tmux new-session -d -s Aki -e ... failed with exit code 1:
```

The omitted middle of the command was the full environment passed through `tmux -e`, including the generated `AGENT_PROMPT` and Voicetree env for terminal `Aki`. The important behavioral difference from Yan's run is that the renderer now reaches `terminal:spawn`; the blocker moved to `spawnTmuxBackedTerminal` / `createSession`.

## Load-Bearing Finding

M1-fix2 changed the failure mode but did not clear the gate:

```text
TerminalVanilla.initTerminal()
  settings.ptyBackend === "tmux"
  -> initRelayTerminal()
  -> window.electronAPI.terminal.spawn(terminalData)
  -> ipc-terminal-handlers terminal:spawn tmux branch
  -> terminalManager.spawnTmuxBacked()
  -> spawnTmuxBackedTerminal()
  -> tmux new-session fails with exit code 1
  -> tmux ls remains empty
```

Phase 6 default-flip remains blocked until Electron tmux-mode panels can create at least three backing tmux sessions before kill/relaunch.

## Calibration Claim

Claim (HIGH ~0.9): Phase 6 remains blocked by tmux-backed session creation from Electron, not by renderer bypass. Falsifier: a fresh Electron tmux-mode debug setup creates three sessions visible in `tmux ls` without changing the tmux session creation path.

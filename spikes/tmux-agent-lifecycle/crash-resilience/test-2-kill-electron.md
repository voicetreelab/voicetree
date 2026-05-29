# BF-314 Test 2: kill Electron

Verdict: M1 FAIL - Electron tmux sessions now spawn and survive `kill -9`, but relaunch does not rebind them. The relaunched main process tries to create the same tmux sessions again and fails with `duplicate session`.

Date: 2026-05-15
Runner: Ama
Worktree: `wt-spike-filesystem-native-agent--1wx`
Commit tested: `acab1714` (`[M1-fix4] fix: filter AGENT_PROMPT/large vars from tmux env (>4KB cap)`)

## Summary

`ptyBackend` was set to `tmux` in `/Users/example/Library/Application Support/Voicetree/settings.json`, backed up to `settings.json.pre-m1-rerun-4-2026-05-15T11-28-29Z`, and restored after cleanup.

Native rebuild passed, and Electron launched headfully with persistent user data and fixed CDP:

```text
VOICETREE_PERSIST_STATE=1 PLAYWRIGHT_MCP_CDP_ENDPOINT=http://localhost:9222 npm --workspace webapp run electron
```

The clean launch auto-loaded `example_small` and spawned three Fake Agent panels: `Aki`, `Ama`, and `Amit`. The load-bearing pre-kill check passed for the first time in this cascade: `tmux ls` showed exactly three live attached sessions. The renderer also showed the three panels with `tmux connected`.

Sentinels were written into all three sessions via `tmux send-keys` and confirmed in tmux scrollback:

```text
sentinel-aki-pre-kill
sentinel-ama-pre-kill
sentinel-amit-pre-kill
```

`kill -9 86501` killed the Electron main process. Immediately after the kill, `tmux ls` still showed `Aki`, `Ama`, and `Amit`, proving the backing sessions survived the Electron crash.

The relaunch failed the rebind requirement. Electron auto-loaded the same project and tried to spawn `Aki`, `Ama`, and `Amit` again. Because the sessions were already alive, `tmux new-session` failed with `duplicate session: Aki`, `duplicate session: Ama`, and `duplicate session: Amit`. `tmux ls` still showed the original sessions and the sentinel scrollback still existed, but the sessions stayed detached and the renderer did not return to the prior `tmux connected` state within the observation window.

This is a fifth distinct layer: M1-fix4 cleared the tmux argv/prompt overflow and proved session creation, but the relaunch path is not idempotent against existing tmux sessions.

## Step Results

| Step | Result | Evidence |
| --- | --- | --- |
| 1. Set runtime `ptyBackend = "tmux"` | PASS | Settings backup created at `settings.json.pre-m1-rerun-4-2026-05-15T11-28-29Z`. Renderer confirmed `ptyBackend: "tmux"`. Settings restored after cleanup. |
| 2. Build natives and launch Electron | PASS | `scripts/rebuild-native.sh` passed. Electron script rebuilt natives again and launched with CDP `9222`, MCP `3001`, and persistent user data. |
| 3. Trigger debug setup | PASS | Startup auto-setup completed with `{"terminalsSpawned":["Aki","Ama","Amit"],"nodeCount":31,...}`. Main logged tmux-backed spawn for all three. |
| 4. Verify `tmux ls` before kill | PASS | At `2026-05-15T11:30:56Z`, `tmux ls` showed `Aki`, `Ama`, and `Amit` as attached sessions. |
| 5. Emit sentinels | PASS | `tmux capture-pane -p -S -200` for each session showed the relevant `echo "sentinel-*-pre-kill"` command and output. |
| 6. Capture Electron PID | PASS | Main Electron PID before kill: `86501`; wrapper PID: `85825`; electron-vite PID: `86456`. |
| 7. `kill -9 $ELECTRON_PID` | PASS | `kill -9 86501` at `2026-05-15T11:31:33Z`. |
| 8. `tmux ls` between kill and relaunch | PASS | Immediately after kill, `tmux ls` still showed `Aki`, `Ama`, and `Amit`. |
| 9. Relaunch and observe panel rebind | FAIL | Relaunch tried `tmux new-session -s Aki/Ama/Amit` and failed with `duplicate session`; sessions remained detached and renderer did not show `tmux connected` after relaunch. |

## Timestamps

- Settings override timestamp: 2026-05-15T11:28:29Z
- Clean Electron launch reached DevTools/MCP: 2026-05-15T11:30:19Z
- Debug setup completed and reported `Aki`, `Ama`, `Amit`: 2026-05-15T11:30:35Z
- Pre-kill `tmux ls` check: 2026-05-15T11:30:56Z
- Electron kill timestamp: 2026-05-15T11:31:33Z
- Relaunch reached DevTools/MCP: 2026-05-15T11:31:55Z
- Relaunch duplicate-session failure observed: 2026-05-15T11:32:09Z
- Post-relaunch observation: 2026-05-15T11:32:35Z
- Cleanup completed after restoring settings and killing test sessions.

## Process Evidence

Before kill:

```text
85825 sh -c ../scripts/rebuild-native.sh && electron-vite dev
86456 node .../webapp/node_modules/.bin/electron-vite dev
86501 .../webapp/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .
86976 .../Electron Helper (Renderer) ... --remote-debugging-port=9222 ...
```

The tested kill was:

```text
kill -9 86501
```

After cleanup, no matching Electron/electron-vite process for this worktree remained, and `tmux ls` returned:

```text
no server running on /private/tmp/tmux-501/default
```

## `tmux ls` Evidence

Baseline before clean launch:

```text
no server running on /private/tmp/tmux-501/default
```

Before kill:

```text
2026-05-15T11:30:56Z
Aki: 1 windows (created Fri May 15 21:30:36 2026) (attached)
Ama: 1 windows (created Fri May 15 21:30:36 2026) (attached)
Amit: 1 windows (created Fri May 15 21:30:36 2026) (attached)
```

Immediately after `kill -9 86501`:

```text
2026-05-15T11:31:33Z
Aki: 1 windows (created Fri May 15 21:30:36 2026)
Ama: 1 windows (created Fri May 15 21:30:36 2026)
Amit: 1 windows (created Fri May 15 21:30:36 2026)
```

After relaunch:

```text
2026-05-15T11:32:35Z
Aki: 1 windows (created Fri May 15 21:30:36 2026)
Ama: 1 windows (created Fri May 15 21:30:36 2026)
Amit: 1 windows (created Fri May 15 21:30:36 2026)
```

The missing `(attached)` marker after relaunch is load-bearing: the original sessions survived, but the relaunched app did not reattach to them.

## Sentinel Evidence

Pre-kill pane capture:

```text
===== Aki =====
echo "sentinel-aki-pre-kill"
sentinel-aki-pre-kill

===== Ama =====
echo "sentinel-ama-pre-kill"
sentinel-ama-pre-kill

===== Amit =====
echo "sentinel-amit-pre-kill"
sentinel-amit-pre-kill
```

Post-relaunch pane capture still found the sentinel lines via `tmux capture-pane -p -S -200`:

```text
===== Aki full capture sentinel grep =====
11: echo "sentinel-aki-pre-kill"
13: sentinel-aki-pre-kill
===== Ama full capture sentinel grep =====
11: echo "sentinel-ama-pre-kill"
13: sentinel-ama-pre-kill
===== Amit full capture sentinel grep =====
11: echo "sentinel-amit-pre-kill"
13: sentinel-amit-pre-kill
```

Screenshots captured for audit:

```text
/tmp/m1-rerun-4-pre-kill.png
/tmp/m1-rerun-4-post-relaunch.png
```

## Main-Process Evidence

Initial clean spawn succeeded:

```text
[Startup] Playwright debug auto-setup complete: {"terminalsSpawned":["Aki","Ama","Amit"],"nodeCount":31,"projectLoaded":".../webapp/public/example_small"}
[headlessAgentManager] Spawned tmux-backed terminal Aki (pid=87293) ... headless=false
[headlessAgentManager] Spawned tmux-backed terminal Ama (pid=87321) ... headless=false
[headlessAgentManager] Spawned tmux-backed terminal Amit (pid=87357) ... headless=false
```

Relaunch failed to rebind because it retried creation:

```text
[Startup] Playwright debug auto-setup complete: {"terminalsSpawned":["Aki","Ama","Amit"],"nodeCount":34,"projectLoaded":".../webapp/public/example_small"}
Failed to spawn tmux-backed terminal Aki: Error: tmux new-session ... failed with exit code 1: duplicate session: Aki
Failed to spawn tmux-backed terminal Ama: Error: tmux new-session ... failed with exit code 1: duplicate session: Ama
Failed to spawn tmux-backed terminal Amit: Error: tmux new-session ... failed with exit code 1: duplicate session: Amit
```

## Load-Bearing Finding

M1-fix4 cleared the previous failure surface. The interactive Electron tmux path can now create sessions with filtered env:

```text
TerminalVanilla.initTerminal()
  settings.ptyBackend === "tmux"
  -> initRelayTerminal()
  -> window.electronAPI.terminal.spawn(terminalData)
  -> terminalManager.spawnTmuxBacked()
  -> tmux new-session succeeds for Aki/Ama/Amit
```

The new failure is on crash recovery:

```text
Electron killed with tmux sessions alive
  -> relaunch loads same project and terminal nodes
  -> debug setup / spawn path calls terminalManager.spawnTmuxBacked() again
  -> tmux new-session -s Aki/Ama/Amit
  -> duplicate session
  -> renderer does not reattach within 5s
```

## Diagnostic Hypothesis

Phase 6 remains blocked until the Electron tmux spawn/reconciliation path becomes idempotent. On relaunch, an existing tmux session with the requested terminal ID should be treated as a reusable backing session and the renderer should attach to it, not as a spawn failure. The likely fix is either:

1. Have `TerminalManager.spawnTmuxBacked()` / `spawnTmuxBackedTerminal()` detect `duplicate session` and return success when the existing session matches the requested terminal identity.
2. Reconcile persisted terminal registry entries before debug auto-setup or before renderer terminal initialization, so relaunch attaches to live sessions instead of issuing fresh `new-session` calls.

Phase 6 default-flip remains blocked because the core promise is not just "sessions survive Electron"; it is "sessions survive and the UI rebinds to them."

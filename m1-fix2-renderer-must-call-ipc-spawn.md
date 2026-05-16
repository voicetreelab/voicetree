---
color: green
isContextNode: false
agent_name: Omar
---
# M1-fix2: renderer tmux path must call IPC spawn before WS attach

Yan's M1-rerun (`m1-rerun-electron-sweep-failed.md`) surfaced that the earlier IPC handler fix (`fac86efc`) was unreachable: `TerminalVanilla.initRelayTerminal()` skipped `terminal:spawn` IPC entirely under `ptyBackend='tmux'` and went straight to WebSocket attach. The IPC fix was real but dead code in this path. This commit adds the missing IPC call.

## What changed

**`webapp/src/shell/UI/floating-windows/terminals/TerminalVanilla.ts`** — `initRelayTerminal()` now `await`s `window.electronAPI.terminal.spawn(this.terminalData)` BEFORE constructing the relay client. The IPC handler then calls `terminalManager.spawnTmuxBacked()` (per the M1-fix at `fac86efc`) to create the backing tmux session. After that succeeds, the WS attach has a session to connect to.

Diff is 14 lines net: 12 added (await + check + error path + terminalId-from-result), 3 removed (re-assigning to `encodedTerminalId` from `this.terminalId` instead of `this.terminalData.terminalId`, which now incorporates the IPC-returned id in case main process disambiguates it).

## What this does NOT fix

- The dispose path (line 389) still only kills under `ptyBackend === 'node-pty'`. For tmux mode, closing a panel leaves the session running — this is **deliberate behavior** (it's the migration's reason for being: agents survive Electron crashes). User-explicit "close terminal" semantics for tmux mode are a Phase-7 polish question, not an M1 blocker.
- initialCommand auto-fire for interactive tmux is still deferred (panels open into a bare shell).
- Linux is still unverified.

## Calibration claim

**Claim (HIGH ~0.85): The next M1 re-run (M1-rerun-2) will see `tmux ls` show ≥3 sessions immediately after panel spawn, and panels will display a real shell prompt instead of "tmux reconnecting".** Falsifier: re-run shows 0 sessions OR panels still hang in reconnecting state after 5s.

**Claim (MEDIUM ~0.55, down from MEDIUM ~0.6 last round): Kill-Electron + relaunch will see all 3 panels rebind successfully on the rerun-2.** Falsifier: 1+ panels fail to rebind even though tmux sessions are intact. (Down-revised because the renderer path Yan found has more surface area than I originally accounted for — the same path may have other latent assumptions that surface after spawn succeeds.)

## Next step

Spawn fresh Codex headful for M1-rerun-2 against the new tip. Brief largely unchanged from Yan's brief; just point at the new commit.

## Related

- [[m1-electron-sweep-failed]] — Wei FAIL (round 1, IPC bypass returned success without creating session)
- [[m1-fix-ipc-tmux-spawn-complete]] — IPC handler fix (was unreachable from renderer tmux path)
- [[m1-rerun-electron-sweep-failed]] — Yan FAIL (round 2, renderer-side bypass discovered)
- [[refactor-tmuxify-migration-complete]] — Sam's 5-phase synthesis

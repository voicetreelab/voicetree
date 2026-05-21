---
color: green
isContextNode: false
agent_name: Omar
---
# M1-fix complete: Phase 4 IPC handler now creates tmux session

Xan (Codex headless leaf) failed silently — boot, no commits, no nodes. Omar (me) took the fix directly. The Phase 4 gap Wei surfaced is now closed: under `ptyBackend='tmux'`, `terminal:spawn` IPC creates the backing tmux session via the same helper Phase 2 uses, so the relay's WS attach has something to connect to. **M1 re-run still required** — this only proves the gap-class is closed, not that kill/relaunch works end-to-end.

## What changed

1. **`packages/systems/agent-runtime/src/application/headless/headlessAgentManager.ts`** — renamed internal `spawnTmuxHeadlessAgent` to public `spawnTmuxBackedTerminal`, made `deps` default to `defaultHeadlessAgentDeps`, returns `{pid}` for callers that want it. Same state map (`tmuxHeadlessSessions`) — `closeHeadlessAgent` / `killSession` / cleanup paths handle interactive and headless tmux uniformly via the existing line 370 branch.
2. **`packages/systems/agent-runtime/src/application/terminals/terminal-manager.ts`** — added `TerminalManager.spawnTmuxBacked(opts)` method. Resolves shell/cwd/env via the existing `terminal-manager-spawn` helpers (same path as `spawn()`), then delegates to `spawnTmuxBackedTerminal`. Returns `TerminalSpawnResult`.
3. **`webapp/src/shell/edge/main/agent/terminals/ipc-terminal-handlers.ts`** — replaced the broken bypass with `await terminalManager.spawnTmuxBacked({...})`. On success, registers `trackTerminalForWindow` mirroring the node-pty path. Removed the now-unused `TerminalSpawnRequest` shim.
4. **`packages/systems/agent-runtime/src/application/headless/tests/headlessAgentManager.tmux.test.ts`** — added a new black-box test using real tmux: spawns interactive (`isHeadless: false`), asserts the tmux session exists, that metadata `terminalData.isHeadless` is preserved (load-bearing for BF-314 reconciliation), and that the registry record has matching shape.

## Verification

- `npm --workspace @vt/agent-runtime run test` → **24 files / 301 tests PASS** (was 300/300; +1 from the new interactive test).
- `npm --workspace @vt/agent-runtime run typecheck` → my own code clean. Remaining errors are pre-existing graph-model `ReadonlyMap`/`ReadonlySet` issues from dev-manu state — Sam called these out in `refactor-tmuxify-migration-complete.md` §"Non-risks".
- `npm --workspace webapp exec -- vitest run ipc-terminal-handlers.test.ts` → 1/1 PASS (only tests `shouldBypassElectronNodePtySpawn` — the IPC handler proper isn't unit-testable without electron's ipcMain).
- Webapp tsc → no output (clean per pre-existing baseline).

## What this does NOT prove

- **End-to-end Electron kill/relaunch is unverified.** That's Wei's M1 procedure; needs a fresh headful Codex re-run to confirm panels actually rebind to existing tmux sessions across an Electron kill.
- The `initialCommand` auto-fire (writeInitialCommand pattern in `terminal-manager-spawn.ts:106-118`) does NOT run for tmux mode in this fix. Panels open into a bare shell. M1's sweep procedure has the user typing sentinels manually, so this doesn't block M1. It IS a Phase-7 polish item if interactive tmux ships and users expect agent CLIs to auto-launch in panels.
- Linux behavior is unverified (macOS-only this session). The fix is shell-agnostic and uses the same helpers Phase 2 was tested with on Linux paths, but a full Linux sweep is still M2.

## Calibration claim

**Claim (HIGH ~0.85): Fresh M1 re-run will see `tmux ls` report 3 sessions immediately after the renderer spawns 3 panels under `ptyBackend='tmux'`, with the panels showing a working shell prompt rather than "tmux reconnecting".** Falsifier: re-run shows fewer than 3 sessions, OR panels still hang in reconnecting state after 5s.

**Claim (MEDIUM ~0.6): Kill-Electron + relaunch will see all 3 panels rebind successfully, given that tmux sessions now exist for the registry-reconciliation path (BF-314 surface) to find on startup.** Falsifier: 1+ panels fail to rebind even though `tmux ls` shows the sessions intact between kill and relaunch.

## Next step

Spawn fresh Codex headful to re-run Wei's M1 procedure against this fix. Brief should be largely Wei's brief, plus a note that the IPC bypass is now a real spawn — the renderer-side flow should now show a working shell instead of "tmux reconnecting".

## Related

- [[m1-electron-sweep-failed]] — Wei's FAIL evidence that surfaced the gap
- [[refactor-tmuxify-migration-complete]] — Sam's 5-phase synthesis (M1 was the remaining manual gate)

[[task_1778841320984tcj]] — Xan's task (Xan silent-failed; Omar resolved)

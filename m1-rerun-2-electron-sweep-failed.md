---
color: red
isContextNode: false
agent_name: Zoe
---
# M1-rerun-2 FAIL: tmux-backed spawn fails before sessions

M1 FAIL against `8eb72a89`: M1-fix2 moved the failure past the renderer bypass, but Electron tmux-mode debug setup still created zero tmux sessions because `spawnTmuxBackedTerminal()` / `tmux new-session` failed with exit code 1. Phase 6 remains blocked.

## Verdict

**M1 FAIL - renderer now reaches `terminal:spawn`, but tmux-backed spawn fails before creating sessions. Phase 6 stays gated.**

## Evidence

- Tested commit: `8eb72a89` (`[M1-fix2] feat: renderer tmux path calls IPC spawn before WS attach`).
- Runtime override: `/Users/bobbobby/Library/Application Support/Voicetree/settings.json` backed up to `settings.json.pre-m1-rerun-2-2026-05-15T11-02-44-3NZ`, set top-level `"ptyBackend": "tmux"`, confirmed in renderer via `window.electronAPI.main.loadSettings()` as `{ ptyBackend: "tmux", agents: 8 }`, then restored.
- Build/launch: `scripts/rebuild-native.sh` PASS; `VOICETREE_PERSIST_STATE=1 npm --workspace webapp run electron` launched headful Electron with CDP on `9222` and MCP on `3001`.
- Debug setup: `window.electronAPI.main.prettySetupAppForElectronDebugging()` returned successfully. UI showed `Aki`, `Ama`, `Amit`; a second invocation showed `Amy`, `Anna`, `Ari`.
- Load-bearing gate: `tmux ls` stayed empty (`no server running on /private/tmp/tmux-501/default`). No sentinel was emitted and kill/relaunch was not run.
- Main-process log: `Failed to spawn tmux-backed terminal Aki: Error: tmux new-session -d -s Aki -e ... failed with exit code 1:`.
- Screenshot: `/tmp/vt-debug/screenshots/m1-rerun-2-17788428957964bc.png`.
- Cleanup: settings restored, worktree Electron/electron-vite processes killed, `tmux ls` still empty.

## Load-Bearing Finding

Round 2's renderer bypass is fixed enough to reach IPC. The new blocker is lower in the stack:

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

## Learnings

1. Tried Yan's exact debug setup first and did not proceed to manual kill because the pre-kill `tmux ls` gate failed.
2. Future agents may mistake this for Yan's old renderer-bypass failure. It is not: the main log proves the renderer now reaches `terminal:spawn` and fails inside tmux-backed session creation.
3. To continue without repeating this reasoning, believe that Phase 6 is still blocked until Electron tmux-mode panels can create at least three backing sessions before any kill/relaunch resilience claim is meaningful.

## Files Changed

- `spikes/tmux-agent-lifecycle/crash-resilience/test-2-kill-electron.md` overwritten with round-3 failure evidence.

## Files Changed

- spikes/tmux-agent-lifecycle/crash-resilience/test-2-kill-electron.md

### NOTES

- No production code changed.
- Commit should include the forced-added evidence markdown plus this summary node if the worktree ignore rules require it.

## Related

- [m1-fix2-renderer-must-call-ipc-spawn](m1-fix2-renderer-must-call-ipc-spawn.md)
- [m1-rerun-electron-sweep-failed](m1-rerun-electron-sweep-failed.md)
- [refactor-tmuxify-migration-complete](refactor-tmuxify-migration-complete.md)

[[task_17788428957964bc]]

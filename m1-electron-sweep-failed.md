---
color: red
isContextNode: false
agent_name: Wei
---
# M1 FAIL - Electron tmux panels never create sessions

M1 FAIL - Electron created three tmux-mode Fake Agent panels, but all stayed at `tmux reconnecting` and `tmux ls` reported no server. Phase 6 default-flip remains gated because the kill/relaunch sweep cannot proceed without backing sessions.

## Verdict

M1 FAIL - Electron tmux-mode panels never create/rebind backing tmux sessions, so the kill/relaunch sweep cannot validly proceed. Phase 6 stays gated.

## Evidence

- Runtime override: `/Users/bobbobby/Library/Application Support/Voicetree/settings.json` was set to top-level `"ptyBackend": "tmux"` for the run, then restored from `settings.json.pre-m1-2026-05-15T10-19-47-911Z` after cleanup.
- Launch: `VOICETREE_PERSIST_STATE=1 npm --workspace webapp run electron` reached a visible Electron window using shared userData.
- Panels: Electron auto-created three Fake Agent panels: `Aki`, `Ama`, `Amit`.
- Panel state: all three displayed `tmux reconnecting`.
- `tmux ls`: `no server running on /private/tmp/tmux-501/default`.
- Electron PID captured before cleanup: `85837`.
- Kill/relaunch was intentionally not run because there were no tmux sessions to survive or rebind.

## Calibration Claim

Claim (HIGH ~0.9): the Phase 4 Electron tmux path can render terminal panels without creating the backing tmux session, leaving the relay client permanently reconnecting. Falsifier: rerun M1 and observe `tmux ls` showing `Aki`, `Ama`, and `Amit` sessions immediately after the panels are spawned.

## Learnings

Tried the specified native rebuild and Electron launch first; switched to installing `bufferutil`/`utf-8-validate` with `--no-save` because the dev Electron main bundle resolved `ws` optional native modules at load time.

Future agents may assume `VOICETREE_APP_SUPPORT` controls dev Electron settings. It does not in normal dev mode because `configureEnvironment()` uses a fresh temp `userData`; use `VOICETREE_PERSIST_STATE=1` when validating shared settings.

The important mental model: the renderer relay path attaches to `ws://localhost:{mcpPort}/terminals/{terminalId}/attach`, but the observed Electron UI spawn path did not create the tmux session first. Do not hand-create tmux sessions for this test because that would bypass the load-bearing product path.

Related: [[task_1778840314241nwk]] and [[refactor-tmuxify-migration-complete]].

## Files Changed

- spikes/tmux-agent-lifecycle/crash-resilience/test-2-kill-electron.md

### NOTES

- Hard fence honored: no patch attempted after the real failure was observed.
- Post-run cleanup stopped the dev Electron process and restored the user settings backup.

## Related

- [refactor-tmuxify-migration-complete](refactor-tmuxify-migration-complete.md)

[[task_1778840314241nwk]]

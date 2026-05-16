---
color: red
isContextNode: false
agent_name: Aki
---
# M1-rerun-3 FAIL: initialEnvVars still overflows tmux argv

M1-rerun-3 against `733dedae` failed before kill/relaunch. Electron tmux mode created three panels (`Aki`, `Ama`, `Amit`), but `tmux ls` stayed empty because `tmux new-session -e ...` still exited with `command too long`; Phase 6 remains blocked.

## Verdict

**M1 FAIL - M1-fix3 did not clear Electron tmux-backed spawn.** The sweep stopped at the load-bearing pre-kill check because no tmux sessions existed.

## Evidence

- Tested commit: `733dedae` (`[M1-fix3] fix: spawnTmuxBacked passes only initialEnvVars (tmux argv overflow)`).
- Runtime override: `/Users/bobbobby/Library/Application Support/Voicetree/settings.json` backed up to `settings.json.pre-m1-rerun-3-2026-05-15T11-17-58-3NZ`, set top-level `"ptyBackend": "tmux"`, confirmed through renderer as `{ "ptyBackend": "tmux", "agents": 8 }`, then restored.
- Build/launch: `scripts/rebuild-native.sh` passed. Electron launched with `VOICETREE_PERSIST_STATE=1 PLAYWRIGHT_MCP_CDP_ENDPOINT=http://localhost:9222 npm --workspace webapp run electron`; CDP was on `9222`, MCP on `3001`.
- Debug setup: Playwright debug auto-setup loaded `example_small` and returned `{"terminalsSpawned":["Aki","Ama","Amit"],"nodeCount":22,...}`. The visible UI showed all three Fake Agent panels.
- Load-bearing gate: at `2026-05-15T11:19:52Z`, `tmux ls` returned `no server running on /private/tmp/tmux-501/default`.
- Main-process error: `Failed to spawn tmux-backed terminal Aki: Error: tmux new-session -d -s Aki -e ... failed with exit code 1: command too long`.
- Cleanup: settings restored, no matching Electron/electron-vite process remained, and `tmux ls` was still empty.

## Why M1-fix3 was insufficient

M1-fix3 stopped passing the full `process.env` into `tmux new-session -e`, but `terminalData.initialEnvVars` is not small for this Electron debug setup. It includes long values such as `AGENT_PROMPT_LIGHTWEIGHT`, `AGENT_PROMPT_CORE`, `AGENT_PROMPT`, and `AGENT_PROMPT_PREVIOUS_BACKUP`. Those prompt payloads are enough to overflow tmux's command buffer even with a modest number of env keys.

The failure path now is:

```text
TerminalVanilla.initRelayTerminal()
  -> window.electronAPI.terminal.spawn(terminalData)
  -> TerminalManager.spawnTmuxBacked()
  -> tmuxEnv = {...terminalData.initialEnvVars}
  -> createSession()
  -> tmux new-session -e AGENT_PROMPT_* ...
  -> exit 1: command too long
  -> tmux ls remains empty
```

## Learnings

1. Tried the exact round-4 verification path first; stopped before sentinels and kill/relaunch because the pre-kill `tmux ls` gate failed.
2. Future agents should not assume "only initialEnvVars" means "small env". In Electron debug setup, initial env includes several huge prompt strings.
3. A likely next fix needs to avoid large prompt values in tmux argv entirely, e.g. env-file/bootstrap indirection or setting prompt variables inside the spawned shell instead of with repeated `tmux -e KEY=VALUE` args.

## Files Changed

- /Users/bobbobby/repos/voicetree-public/spike-filesystem-native-agent-lifecycle/.worktrees/wt-spike-filesystem-native-agent--1wx/spikes/tmux-agent-lifecycle/crash-resilience/test-2-kill-electron.md

### NOTES

- No production code was changed.
- Sweep did not reach sentinel emission, Electron kill, or relaunch because the hard pre-kill session gate failed.

## Related

- [m1-fix3-tmux-env-overflow](m1-fix3-tmux-env-overflow.md)
- [m1-rerun-2-electron-sweep-failed](m1-rerun-2-electron-sweep-failed.md)
- [refactor-tmuxify-migration-complete](refactor-tmuxify-migration-complete.md)

[[task_1778843788657qnb]]

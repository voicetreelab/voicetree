---
color: red
isContextNode: false
agent_name: Ama
---
# M1-rerun-4 FAIL: sessions survive kill, relaunch does not rebind

M1-rerun-4 against `acab1714` moved past all previous spawn failures: Electron tmux mode created exactly three sessions (`Aki`, `Ama`, `Amit`), all three panels showed `tmux connected`, sentinels were written, and `kill -9` of the Electron main process left all three tmux sessions alive.

The sweep still FAILs because relaunch did not rebind those sessions. The relaunched app auto-loaded `example_small`, ran debug setup, and attempted `tmux new-session -s Aki/Ama/Amit` again. tmux rejected all three with `duplicate session`, the original sessions stayed detached, and the renderer did not return to the pre-kill `tmux connected` state within the observation window.

## Verdict

**M1 FAIL - Electron tmux sessions now spawn and survive `kill -9`, but relaunch retries creation instead of reattaching to the live sessions. Phase 6 remains blocked.**

## Evidence

- Tested commit: `acab1714` (`[M1-fix4] fix: filter AGENT_PROMPT/large vars from tmux env (>4KB cap)`).
- Runtime override: `/Users/bobbobby/Library/Application Support/Voicetree/settings.json` backed up to `settings.json.pre-m1-rerun-4-2026-05-15T11-28-29Z`, set top-level `"ptyBackend": "tmux"`, confirmed through renderer, then restored.
- Build/launch: `scripts/rebuild-native.sh` passed. Electron launched with `VOICETREE_PERSIST_STATE=1 PLAYWRIGHT_MCP_CDP_ENDPOINT=http://localhost:9222 npm --workspace webapp run electron`.
- Pre-kill gate: `tmux ls` at `2026-05-15T11:30:56Z` showed exactly `Aki`, `Ama`, and `Amit`, all attached.
- Sentinels: `sentinel-aki-pre-kill`, `sentinel-ama-pre-kill`, and `sentinel-amit-pre-kill` were visible in `tmux capture-pane` before kill and still present after relaunch.
- Kill: Electron PID `86501` was killed at `2026-05-15T11:31:33Z`; immediate `tmux ls` still showed all three sessions alive.
- Relaunch: at `2026-05-15T11:32:09Z`, main logged `duplicate session: Aki`, `duplicate session: Ama`, and `duplicate session: Amit`; post-relaunch `tmux ls` showed the original sessions still detached.
- Cleanup: restored user settings, killed the three test tmux sessions, and confirmed `tmux ls` returned no server.

## Diagnostic Hypothesis

This is a fifth distinct layer. The remaining blocker is idempotent recovery: relaunch must treat an existing session for the requested terminal ID as reusable and attach to it, not attempt a fresh `tmux new-session`.

Likely fix path:

1. Make `spawnTmuxBackedTerminal()` / `TerminalManager.spawnTmuxBacked()` detect `duplicate session` and return a successful existing-session result when the session identity matches.
2. Or reconcile live tmux sessions from the persisted terminal registry before debug auto-setup / renderer initialization, so the renderer attaches instead of respawning.

## Related

- [[m1-fix4-filter-agent-prompts-from-tmux-env]]
- [[m1-rerun-3-electron-sweep-failed]]
- [[refactor-tmuxify-migration-complete]]

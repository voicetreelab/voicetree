# tmux

Terminal-multiplexer server lifecycle + agent pane management.

## Architecture

tmux is a **client-server** program. The server is a separate OS process that self-daemonizes via `setsid()`. Agents (claude, codex, …) live as children of the **server**, not children of Electron.

```
   Electron main                    tmux server  (separate process)
   ├─ ms-lived tmux CLI clients  ↔  ├─ agent pane (claude)
   └─ relay (../relay/)          ↔  └─ agent pane (codex)
                                    (root keepalive session)
```

Comm: UNIX socket at `$APP_SUPPORT/Voicetree/tmux.sock`. CLI commands are short-lived clients; the server holds all session state.

## Files in this folder

- `tmux-server.ts` — server lifecycle: ensure / verify / shutdown / priority raise
- `tmux-server-core.ts` — pure helpers: exec, paths, error parsing
- `tmux-session-manager.ts` — create/kill/has session + name resolution alias map
- `tmuxSpawnPlanning.ts` — translate (agent + env + cwd) → tmux command
- `tmux-preflight.ts` — startup checks (tmux binary present, socket dir writable)
- `unclaimed-tmux.ts` — discover sessions whose owning Electron is gone, so the renderer can offer to reattach

Live attach (renderer xterm ↔ pty) lives in `../relay/tmux-attach-relay.ts`.

## Vision

VT's long-term shape is **engine + client**: tmux server, vt-graphd, and vt-mcpd all run as durable backend services; Electron is a UI projection that comes and goes. Closing the window doesn't stop work, like closing pgAdmin doesn't stop postgres. See `dev-dev/voicetree-22-5/voicetree-global-architecture-2026-05-25.md` for the boxes-and-arrows.

## Design decisions

- **tmux server survives Electron quit.** On Cmd+Q with active sessions, prompt user (preserve/terminate). On crash, default preserve (no handler runs anyway). On explicit window close, preserve.
- **Jetsam protection is macOS-only and set at creation time** via `taskpolicy -a sh -c "<cmd>"`. Role propagates through fork/exec/sh. See `dev-dev/voicetree-22-5/tmux-architecture-final-recommendation-2026-05-25.md`.
- **Logs are the durability layer.** `tmux pipe-pane` mirrors each pane to `<vault>/.voicetree/terminals/<terminalId>.log`. Process state is ephemeral; that file is not.

## Foot guns

1. **`taskpolicy -c <class> -p $pid` is not elevation.** `-c` is a *clamp* (ceiling, can only lower QoS). `-p` mode doesn't accept `-c`/`-a` at all — only `-b/-B/-t/-l`. Earlier code called this and silently failed. Use `-a` at creation, not post-hoc.
2. **The tmux CLI process is not the server.** `{detached: true}` on `tmux new-session` affects only the ms-lived CLI. The server self-daemonizes regardless. Don't conflate the two when reasoning about lifecycle.
3. **You can't retroactively elevate a running server's app role.** Public API only sets role at creation. Old servers stay un-elevated until restart — plan migrations accordingly.
4. **Tmux dying = all agents die.** Closing pty masters → SIGHUP cascade → agents terminate. Only pipe-pane logs survive. This is why jetsam protection is load-bearing on macOS.
5. **Two shutdown paths kill tmux on quit.** `terminalManager.cleanup()` (kills sessions) AND `shutdownTmuxServer()` (kills server). Both must be gated on the lifecycle policy — removing only one is incomplete.
6. **Session names go through an alias map.** Several callers depend on a process-local mutable map in `tmux-session-manager.ts` + env-derived namespace hashing. If you bypass it you get split-brain sessions.

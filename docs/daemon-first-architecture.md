# Daemon-First Architecture (v1)

## Source Of Truth

- `vt-graphd` is the canonical owner of live vault state for one vault.
- That ownership includes the mounted watcher, read/write path configuration, parsed graph, and server-side session view state.
- Electron main still exists in v1, but only as a transport adapter for renderer IPC.
- `@vt/graph-model` and `@vt/graph-state` stay as the implementation libraries under the daemon; they are no longer the cross-process ownership boundary.

## Transport Map

```text
Renderer UI
  -> Electron IPC
  -> Electron main proxy
  -> @vt/graph-db-client
  -> vt-graphd

vt vault/session/view
  -> @vt/graph-db-client
  -> vt-graphd

MCP graph/live-state tools
  -> existing MCP server
  -> daemon proxy hop
  -> vt-graphd

MCP agent-control tools
  -> existing MCP server only
  -> no daemon move in v1
```

## v1 Boundary

- Moved to the daemon in v1:
  - vault endpoints
  - graph snapshot endpoint
  - per-session view endpoints (`sessions`, `state`, `collapse`, `selection`, `layout`)
- Not moved in v1:
  - agent spawn/list/wait/close/send flows
  - the broader engine/orchestration runtime
  - CLI commands that operate on local filesystem/index helpers rather than live daemon state

## Coordination Note

This file is the BF-230 coordination artifact for archive-time citation.

- `brain/working-memory/tasks/other_todo_reorganize/BF-058-vt-cli-default-interface.md`
  - Treat daemon-backed `vt vault`, `vt session`, and `vt view` flows as the stable default interface for live graph state.
  - Do not overclaim full daemon migration: agent-control flows still live on the MCP/Electron side in v1.
- `brain/working-memory/tasks/BF-104-decouple-webapp/arch.md`
  - The backend split for graph/vault/view state is now real in repo code through `packages/graph-db-server/` and `packages/graph-db-client/`.
  - Remaining BF-104 extraction work should be framed as the engine/agent-control split, not as graph-state ownership still living in Electron main.

## Files To Cite

- `packages/graph-db-server/README.md`
- `CLAUDE.md`
- `docs/daemon-first-architecture.md`

## Open Reality Check

- v1 keeps a split world on purpose: graph/live-state traffic proxies to the daemon, while agent-control MCP remains where it is.
- Any future doc that says "MCP moved into the daemon" is wrong for this branch.

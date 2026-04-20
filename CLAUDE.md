If ~/brain/SKILL.md exists, read it before starting work — it is the Brainforest agent operating system (lifecycle, recall, calibration, gardening).
Budget-gated recursion: agents with DEPTH_BUDGET > 0 must decompose multi-concern tasks into sub-agents. DEPTH_BUDGET=0 agents solve directly. See ~/brain/SKILL.md.

If VOICETREE_TERMINAL_ID is set, you are a Voicetree agent. After any context compaction, re-read ~/brain/SKILL.md — your initial prompt may have been summarized away.

## Runtime Architecture (v1)

- `packages/graph-db-server/` provides `vt-graphd`, the daemon that owns canonical vault state for one vault: read paths, write path, parsed graph, watcher lifecycle, and per-session view state.
- Electron main is no longer the source of truth for graph/vault/view state. In v1 it remains a transport adapter that proxies renderer IPC onto the daemon.
- The CLI `vault`, `session`, and `view` entrypoints attach to the same daemon through `@vt/graph-db-client`, so the desktop app and CLI share the same backend behavior.
- MCP graph/live-state tools proxy to `vt-graphd` in v1. Agent-control MCP tools stay on the existing Electron/MCP side until the later engine split.
- Read `packages/graph-db-server/README.md` for daemon operations and `docs/daemon-first-architecture.md` for the architecture boundary and BF-058/BF-104 coordination note.

## 1. Phase 1 — Daemon skeleton + contract  ✅ SHIPPED (L1 `3c216b0d` + L2 `68bdc9e5`; verifier 5/5 PASS)

- [x] 1.1 Create `packages/graph-db-server/` with `package.json`, `tsconfig.json`, `src/`, `bin/vt-graphd.ts`
- [x] 1.2 Create `packages/graph-db-client/` with `package.json`, `tsconfig.json`, `src/`
- [x] 1.3 Define Zod contract module shared by server + client (`packages/graph-db-server/src/contract.ts` re-exported from client) — request/response types for vault, graph, sessions *(scope this phase: HealthResponse + ShutdownResponse + CONTRACT_VERSION=0.1.0; rest land in P2–P4)*
- [x] 1.4 Implement Hono HTTP server bound to `127.0.0.1` on dynamic port; reject non-loopback
- [x] 1.5 Implement port-file write (atomic tmp+rename) at `<vault>/.voicetree/graphd.port` and lock-file at `<vault>/.voicetree/graphd.lock`
- [x] 1.6 Implement `GET /health` returning `{ version, vault, uptimeSeconds, sessionCount }`
- [x] 1.7 Implement `POST /shutdown` — graceful shutdown: close watcher, release lock, delete port file, exit 0  *(watcher lands in P3; shutdown currently closes server → release lock → delete port file → process.exit(0) via `onShutdownComplete` hook)*
- [x] 1.8 Implement single-instance enforcement via exclusive flock on lock file; coalesce concurrent launches (loser detects + exits cleanly)
- [x] 1.9 Stale-lock recovery: if lock file present but PID dead, claim cleanly
- [x] 1.10 Vitest: unit tests for contract, port-file, lock-file, health, shutdown
- [x] 1.11 Vitest: integration test — boot daemon in test, hit /health, send /shutdown, verify clean exit

## 2. Phase 2 — Vault-control endpoints

- [x] 2.1 Implement `GET /vault` returning `{ vaultPath, readPaths, writePath }` from `@vt/graph-model/watch-folder-store`
- [x] 2.2 Implement `POST /vault/read-paths` calling `addReadPath()` from `@vt/graph-model`
- [x] 2.3 Implement `DELETE /vault/read-paths/:encodedPath` calling `removeReadPath()`
- [x] 2.4 Implement `PUT /vault/write-path` calling `setWritePath()`
- [x] 2.5 Path validation: reject paths outside the vault, paths that don't exist (configurable), paths with traversal sequences
- [x] 2.6 Vitest: integration tests for each endpoint hitting an in-process daemon harness with a tmp vault
- [x] 2.7 Verify mutation-functions called are the same exports the UI's IPC handlers call (grep + assertion)

## 3. Phase 3 — Graph endpoint + watcher

- [x] 3.1 Implement `GET /graph` returning `getGraph()` serialised
- [x] 3.2 Mount chokidar watcher over union of read paths; wire create/change/delete events into the in-memory graph (re-use existing handlers from `@vt/graph-model`)
- [x] 3.3 Re-mount watcher when read paths change
- [x] 3.4 Vitest: write an external file inside a read path → next `GET /graph` includes it
- [x] 3.5 Vitest: add a read path at runtime → files under it appear in graph without restart

## 4. Phase 4 — Session manager + view-state endpoints

- [ ] 4.1 Implement `Session` type: `{ id, collapseSet, selection, layout, lastAccessedAt }`; `SessionRegistry` with `create()`, `get()`, `delete()`, `purgeIdle(maxAgeMs)`
- [ ] 4.2 Implement `POST /sessions` minting UUIDv4 sessionId
- [ ] 4.3 Implement `DELETE /sessions/:sessionId`
- [ ] 4.4 Implement `GET /sessions/:sessionId/state` — assemble live-state projection (graph + vault + folder-tree-walk + session collapseSet/selection/layout); reuse `buildLiveStateSnapshot` logic
- [x] 4.5 Implement `POST /sessions/:sessionId/collapse/:folderId` and `DELETE` counterpart, calling `dispatchCollapse`/`dispatchExpand` from `@vt/graph-state` against the session's collapseSet
- [x] 4.6 Implement `POST /sessions/:sessionId/selection` with `{ nodeIds, mode: 'replace'|'add'|'remove' }`
- [x] 4.7 Implement `PUT /sessions/:sessionId/layout` accepting partial `{ positions, pan, zoom }`
- [ ] 4.8 Implement idle-timeout cleanup tick (default 24h, configurable)
- [x] 4.9 Vitest: two sessions hold different collapseSets; mutations on one don't affect the other
- [ ] 4.10 Vitest: pinned-session sharing — two clients with same sessionId see each other's mutations

## 5. Phase 5 — Typed daemon client

- [ ] 5.1 Implement `GraphDbClient` class in `packages/graph-db-client/src/index.ts` — typed methods for every endpoint, derives types from the contract module
- [ ] 5.2 Implement port discovery: read `<vault>/.voicetree/graphd.port`, verify `/health` before issuing
- [ ] 5.3 Implement auto-launch helper: spawn `vt-graphd --vault <path>` detached, poll /health up to 5s, then proceed
- [ ] 5.4 Vitest: client roundtrip against in-process daemon for every endpoint
- [ ] 5.5 Vitest: client cold-start spawns daemon, gets a working connection

## 6. Phase 6 — CLI parity subcommands

- [ ] 6.1 Add `vt vault add-read-path <path>` subcommand wired to client.addReadPath
- [ ] 6.2 Add `vt vault remove-read-path <path>` subcommand
- [ ] 6.3 Add `vt vault set-write-path <path>` subcommand
- [ ] 6.4 Add `vt vault show` subcommand
- [ ] 6.5 Add `vt view collapse <folderId>` subcommand
- [ ] 6.6 Add `vt view expand <folderId>` subcommand
- [ ] 6.7 Add `vt view selection {set|add|remove} <nodeIds...>` subcommands
- [ ] 6.8 Add `vt view show` subcommand
- [ ] 6.9 Implement vault auto-detection (walk up from cwd looking for `.voicetree/`); honour `--vault` override
- [ ] 6.10 Implement session selection: `--session <id>` flag and `VT_SESSION` env var; default to mint-fresh
- [ ] 6.11 Exit codes: 0 success, distinct non-zero codes for arg-validation / network / daemon-4xx / daemon-launch-failure
- [ ] 6.12 CLI e2e (vitest spawning real binary): cold-start `vt vault add-read-path` against a tmp vault — daemon launches, command succeeds, daemon stays up, second invocation reuses it

## 7. Phase 7 — Electron main as proxy

- [ ] 7.1 Wire Electron main boot to launch (or attach to) `vt-graphd` for the user-selected vault; pass daemon port to the renderer if needed
- [ ] 7.2 Replace IPC handler bodies in `webapp/src/shell/edge/main/api.ts` with `daemonClient` calls (one IPC handler at a time, keeping behaviour identical). MUST include on the proxied list: `getGraph`, `getNode`, `getLiveStateSnapshot`, `addReadPath`, `removeReadPath`, `setWritePath`. (Per Kai's B4 caveat: `createAnchoredFloatingEditor`, `modifyNodeContentFromUI`, and `getNodeFromMainToUIOrNull` all call `electronAPI?.main.getGraph()` / `getNode()` directly — these become the load-bearing read paths under the daemon.)
- [ ] 7.3 Remove the chokidar watcher mount from Electron main (daemon now owns it exclusively); verify no double-watching via lsof
- [ ] 7.4 Renderer-side stores (`FolderTreeStore`, `rendererStateMirror`, layout/collapse stores) — confirm they go through the now-proxied IPC and behave unchanged
- [ ] 7.5 Manual smoke: open vault, add/remove read path, set write path, collapse/expand folder, type in editor — all behaviour identical to pre-change
- [ ] 7.6 Wave-B-regression flow (live, on a real vault): click a folder node → editor mounts on folder-note path → type → save → confirm `<folder>/index.md` materializes on disk. Pre-existing Wave B B4 invariant; this is the first time it's exercised end-to-end on a real vault per Kai handover.
- [ ] 7.7 Run existing Playwright e2e suite; fix regressions

## 8. Phase 8 — Cleanup, lint, docs

- [ ] 8.1 Add ESLint rule banning direct imports of `setWritePath`, `addReadPath`, `removeReadPath`, `dispatchCollapse`, `dispatchExpand`, etc., from outside `packages/graph-db-server/`
- [ ] 8.2 Migrate any remaining direct-importer (tests aside; tests get an explicit allow-list comment)
- [ ] 8.3 Delete dead code in `@vt/graph-model` / `@vt/graph-state` if any module is now fully owned by the daemon
- [ ] 8.4 README: `packages/graph-db-server/README.md` documenting how to run standalone, the endpoint contract, and the discovery protocol
- [ ] 8.5 Update top-level CLAUDE.md / agent docs to reflect the new architecture (daemon is the source of truth, MCP proxies for live-state)
- [ ] 8.6 Update `~/brain/working-memory/kanban.md` and the epic kanban — move the epic to Done

## 9. Coordination

- [ ] 9.1 Wait for `unified-folder-file-nodes` (Wave B) B5 to land before starting Phase 7 wiring (Phases 1–6 can run in parallel with Wave B)
- [ ] 9.2 Sync with `BF-058-vt-cli-default-interface` and `BF-104-decouple-webapp` owners — confirm this change is the right umbrella (or supersedes them)
- [ ] 9.3 Validate against `~/brain/feedback_mcp_port_3002.md`: daemon must NOT bind 3002; pick dynamic port

# Headless migration — completion record (Phase A → Phase E)

This file records the completion of the headless migration. The end state:

- `@vt/agent-runtime` owns terminal + headless-agent runtime (PTY, child_process,
  registry, hooks, node injection). Embedded in Electron and consumed by
  `vt-mcpd`.
- `@vt/vt-daemon` owns the MCP HTTP server (tool catalog) and ships a
  `vt-mcpd` binary that runs MCP + graph-db without Electron.
- Boundary-guard tests prevent either package from re-importing `electron`,
  the webapp shell (`@/shell/edge/...`), `uiAPI`, or deep `webapp/src/...`
  paths.
- Electron desktop terminal flow is unchanged.

The plan that drove this work lives at `dev_sprint/wednesday/voicetree-6-5/MIGRATION_PLAN.md`.

## Commit chain

| Phase | Hash | Subject |
| ----- | ---- | ------- |
| A     | 0e435549 | refactor(port-utils): relocate findAvailablePort out of electron/ |
| A     | 1958f4e6 | refactor(terminal-manager): drop WebContents in favour of onData/onExit callbacks |
| A     | 3ebd12b2 | refactor(terminal-registry): replace uiAPI direct call with subscriber API |
| B1    | 6c506bee | chore(agent-runtime): scaffold package |
| B2/B3 | 2e685790 | refactor(agent-runtime): move terminal runtime out of webapp |
| B3 fixup | 9b557ec8 | fix(webapp): point api.ts at @vt/agent-runtime after the move |
| C1    | b802c64f | chore(voicetree-mcp): scaffold package |
| C2    | a2799e7d | refactor(voicetree-mcp): move mcp server out of webapp |
| C2 lint | fc0df026 | fix(webapp): satisfy @typescript-eslint/typedef in C2 touch-up files |
| C3    | 0127a060 | feat(voicetree-mcp): add vt-mcpd binary |
| E guards | 7627f361 | test(headless-boundaries): guard runtime package imports |
| E docs | (this commit) | docs(headless): record migration completion and verification |

Phase D (headless E2E proof) added no commits — fixture lived under `/tmp` and
the swap procedure round-tripped `node_modules/better-sqlite3` to its original
sha256 (see "Native ABI" below).

## Final verification matrix

Run from the repo root.

```text
cd packages/systems/agent-runtime  && npm run typecheck    # own-src clean *
cd packages/systems/agent-runtime  && npm run test         # 10 files, 152 tests pass
cd packages/systems/voicetree-mcp  && npm run typecheck    # own-src clean *
cd packages/systems/voicetree-mcp  && npm run test         #  5 files,  41 tests pass (incl. boundary guard)
cd webapp                  && npx tsc --noEmit     # own-src clean *
npm run test:t0 -- --only=blackbox-tests-lint      # see "Pre-existing" below
cd webapp && npx electron-vite build                # exit 0 — fresh dist-electron/{main,preload}/index.js
```

`*` "own-src clean" = no errors in the package's own `src/`. The
`graph-model`, `graph-state`, `graph-tools`, and `knowledge-graph` upstream
packages still emit the same tsc errors as on `main`; per the migration plan
these are pre-existing and do not block the headless work.

### Headless smoke (vt-mcpd → MCP → graph-store)

From a clean tree (no other vt-graphd locking the fixture):

```bash
# 1. Backup the Electron-built better-sqlite3 (NODE_MODULE_VERSION 139)
cp node_modules/better-sqlite3/build/Release/better_sqlite3.node \
   /tmp/better_sqlite3.electron.node

# 2. Rebuild for plain Node (NODE_MODULE_VERSION 131)
npm rebuild better-sqlite3 --build-from-source

# 3. Run vt-mcpd against a fixture project
npx tsx packages/systems/voicetree-mcp/bin/vt-mcpd.ts \
  --project /tmp/vt-fixture-d-project --port 3502 &

# 4. Probe MCP and call a read tool
curl -sS -X POST http://127.0.0.1:3502/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json,text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
curl -sS -X POST http://127.0.0.1:3502/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json,text/event-stream' \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"graph_structure","arguments":{"folderPath":"/tmp/vt-fixture-d-project"}}}'

# 5. SIGINT to the leaf (clean teardown)
kill -INT "$(pgrep -f vt-mcpd.ts | tail -1)"

# 6. Restore the Electron build (sha256 must round-trip)
cp /tmp/better_sqlite3.electron.node \
   node_modules/better-sqlite3/build/Release/better_sqlite3.node
shasum -a 256 node_modules/better-sqlite3/build/Release/better_sqlite3.node
# expected: b58b85ed020c9702a2d388d3d312147e640b6a341f3f5f60e170176774ea128d
```

Phase E re-ran this on `headless_migration` with port 3502 and confirmed:

- vt-mcpd booted, published `.mcp.json` and `.voicetree/graphd.port`.
- `tools/list` returned all 12 tools (spawn_agent, list_agents,
  wait_for_agents, get_unseen_nodes_nearby, close_agent, send_message,
  read_terminal_output, create_graph, graph_structure, vt_get_live_state,
  vt_dispatch_live_command — and `create_graph` is exposed but rejects
  unknown callers, see "Headless contract" below).
- `graph_structure` returned `N=3 E=2` for the Phase D fixture project.
- SIGINT to the leaf pid removed `graphd.lock` + `graphd.port` and exited
  cleanly.
- Electron `better_sqlite3.node` sha256 restored to
  `b58b85ed020c9702a2d388d3d312147e640b6a341f3f5f60e170176774ea128d`.
- `cd webapp && npx electron-vite build` exit 0 with fresh
  `dist-electron/main/index.js` (2,065,671 bytes) and
  `dist-electron/preload/index.js`.
- Production-only audit empty:
  `rg "from ['\"]electron['\"]|BrowserWindow|ipcMain|webContents" \
   packages/systems/agent-runtime/src packages/systems/voicetree-mcp/{src,bin} \
   --glob '!**/*.test.ts' --glob '!**/__tests__/**'`

## Headless contract: read-via-MCP, write-via-disk-watcher

Phase D found that `create_graph` (and every other write tool) validates
`callerTerminalId` against `getTerminalRecords()`, which vt-mcpd seeds empty
in headless mode. Two options were considered:

- **(a)** Bootstrap a synthetic `cli-root` terminal record on `vt-mcpd` boot.
- **(b)** Document the headless contract as **read-via-MCP, write-via-disk-watcher**.

Phase E **chose (b)**. Reasoning:

- The terminal registry models real PTY / `child_process` agents with budget
  and lifecycle; a synthetic terminal has no real owner and would require new
  policy decisions (budget semantics, id collision, cleanup).
- Phase D already proved the Write→watcher path: the chokidar mount inside
  `startDaemon` reconciles new project files into the graph-store singleton.
- Live-state tools (`vt_get_live_state`, `vt_dispatch_live_command`) are the
  precedent — they appear unconditionally in `tools/list` and reject with a
  clean MCP error in headless mode rather than being hidden.

A header comment in `packages/systems/voicetree-mcp/bin/vt-mcpd.ts` records this
contract for future readers.

## Retained boundary debt (intentional in-process surfaces)

The boundary guards in `packages/{agent-runtime,voicetree-mcp}/src/package-boundaries.test.ts`
forbid Electron / webapp-shell / uiAPI / deep-webapp imports. They explicitly
**do not** forbid these cross-package deep submodule paths, which are the
in-process surfaces both Electron and `vt-mcpd` embed:

- `@vt/graph-db-server/state/graph-store`
- `@vt/graph-db-server/state/watch-folder-store`
- `@vt/graph-db-server/settings/settings_IO`
- `@vt/graph-db-server/watch-folder/project-allowlist`
- `@vt/graph-db-server/graph/applyGraphDelta`
- `@vt/graph-db-server/context-nodes/getUnseenNodesAroundContextNode`
- `@vt/graph-model/pure/graph` (and several deep submodules)
- `@vt/graph-state` (Command / Delta / SerializedState)
- `@vt/agent-runtime` (terminal / headless / registry surface)
- `@vt/graph-tools/node` (markdown body builders)

If a future phase extracts the daemon-process boundary into HTTP, these are
the call sites to revisit.

## Known residual debt

1. **better-sqlite3 dual-ABI install context — DEFERRED.** `better-sqlite3`
   stays hoisted to root `node_modules/`, so a single ABI is on disk at any
   time. Running `vt-mcpd` against plain Node currently requires the
   `npm rebuild` swap above and `cd webapp && npx @electron/rebuild` (or
   `npm rebuild` with the Electron headers) to restore the Electron lane.
   Phase E elected not to introduce a non-hoisted install context — the risk
   of breaking the Electron build path outweighed the benefit, and Phase D
   already verified the swap procedure with a sha256 round-trip. Same trap
   `webapp` already solves for `node-pty`; mirror that pattern when the
   priority comes up.

2. **Live-state tools register unconditionally.** `vt_get_live_state` and
   `vt_dispatch_live_command` appear in headless `tools/list` and reject with
   a clean MCP error. Intentional (deliberate per `c3-vt-mcpd-architecture`).
   Hiding them in headless mode is a `registerLiveTools` change keyed on a
   `createMcpServer` flag — not a `vt-mcpd` change.

3. **`mcp-server.ts` is at 401 lines** (under the 500-line cap). The next
   shape change should split tool registrations (`registerCoreTools.ts`)
   rather than push it past the cap.

4. **Pre-existing `blackbox-tests-lint` failure.** One file —
   `webapp/src/shell/edge/main/runAgentOnSelectedNodes.test.ts` — has 2/3
   mock assertions (66% > 50% threshold). Verified identical to `main`; the
   B2 import-rewrite did not introduce it. Out of scope for the headless
   migration.

5. **Pre-existing upstream tsc errors** in `graph-model`, `graph-state`,
   `graph-tools`, `knowledge-graph` survive on `main`. The migration plan
   tracks them as pre-existing.

## Migration done?

Per `MIGRATION_PLAN.md` "Done Definition":

- [x] `@vt/agent-runtime` contains terminal/headless runtime; typecheck +
      tests green.
- [x] `@vt/vt-daemon` contains MCP server; typecheck + tests green.
- [x] `vt-mcpd` runs without Electron (Phase D + Phase E re-smoke).
- [x] Electron desktop terminal flow unchanged (electron-vite build green;
      Phase B3 smoke + Phase D regression on file).
- [x] Boundary guards in place and passing.
- [x] This document records commit hashes, verification commands, residual
      debt, and the headless E2E result.

DONE.

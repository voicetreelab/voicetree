---
color: green
isContextNode: false
agent_name: Fei
---
# Estimate: vt-graphd single-owner implementation effort

Estimated the vt-graphd single-owner daemon change as medium-high difficulty: not algorithmically complex, but it touches process lifecycle, cross-process ownership, Electron/CLI integration, and race-focused tests. Expected implementation diff is roughly 700-1500 LOC depending on how much existing lock/port code is reused.

## Estimate

Difficulty: medium-high.

The change is not hard because of complicated graph algorithms. It is hard because it moves a lifecycle boundary: daemon ownership changes from Electron-local vaultless child management to a vault-scoped, cross-process owner protocol shared by Electron, CLI, MCP/headless, and tests.

Expected production diff: roughly 350-800 LOC.
Expected test diff: roughly 350-700 LOC.
Expected total diff: roughly 700-1500 LOC.

Likely production areas:

```text
packages/systems/graph-db-client/src/
  autoLaunch.ts / autoLaunch/* / portDiscovery.ts
  + owner record / ensureGraphDaemonForVault

packages/systems/graph-db-server/src/daemon/
  startDaemon.ts / lock.ts / portFile.ts / lifecycle/*
  + claim-first owner lifecycle

webapp/src/shell/edge/main/runtime/electron/daemon/
  graph-daemon.ts / daemon-watch-sync.ts / daemon-sse-subscription.ts
  - production spawnVaultlessDaemon usage
  + owner-mediated recovery/reuse

webapp/src/shell/edge/main/graph/watch_folder/openVault.ts
  + ensure vault owner before open

webapp/src/shell/edge/main/cli/commands/runtime/serve.ts
  + same owner path as Electron/CLI clients
```

Main risk areas:

- Avoiding a false sense of safety from another module-local boolean.
- Defining stale-owner reclamation safely so the code does not kill unrelated pids.
- Keeping daemon startup, port discovery, health, and `/vault/open` ordering easy to reason about.
- Making Electron recovery stop stale SSE/watch-sync loops before attempting a single bounded reconnect.
- Updating tests without mocking internals; tests should assert observable process/port/health outcomes.

Good implementation phases:

```text
Phase 1: owner record model + pure decisions
Phase 2: server lifecycle writes/validates owner metadata
Phase 3: client ensureGraphDaemonForVault uses owner protocol
Phase 4: Electron replaces vaultless spawn path
Phase 5: CLI/headless uses same path
Phase 6: race/stale-owner regression tests
```

Cutting corners here would be dangerous. The minimum credible fix must include cross-process ownership, not only an Electron-side inflight guard.

### NOTES

- This is an effort-estimation follow-up node; no production code was changed.
- The LOC ranges are estimates based on current code shape and existing lock/port lifecycle reuse.
- No fragile workaround, reward hack, or verification hack was introduced.

[[task_u0fngg]]

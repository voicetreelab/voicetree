# Concept → path map

Where each concept's implementation actually *lives* — read the home dir instead of grep-discovering it. Entries are directories unless a file is named. Cross-cutting names with no single home list the primary owner + "use cgcli". Note: `packages/systems/agent-runtime` has no tracked source (stub) — the real agent runtime lives at `vt-daemon/src/agent-runtime/` (row below).

| Concept | Canonical home |
|---|---|
| Daemon entry / core / config | `packages/systems/vt-daemon/src/` (`index.ts`, `core/`, `config/`) |
| Transport (HTTP / WS / SSE) | `packages/systems/vt-daemon/src/transport/` |
| RPC routes | `packages/systems/vt-daemon/src/rpc/` (`*Routes.ts`) |
| Daemon tools (tool catalog) | `packages/systems/vt-daemon/src/tools/` |
| Hooks (Claude hook events) | `packages/systems/vt-daemon/src/hooks/` |
| `create_graph` (graph-create RPC) | `packages/systems/vt-daemon/src/create-graph/` |
| Subgraph component / size gate | `…/create-graph/subgraphComponent.ts` + `packages/measures/src/_subgraph_gate/` |
| Session / live state | `packages/systems/vt-daemon/src/state/` |
| Daemon lifecycle / ownership | `packages/systems/vt-daemon/src/lifecycle/` + `packages/libraries/daemon-lifecycle/src/` |
| Agent runtime (spawn / terminals / inject / recovery) | `packages/systems/vt-daemon/src/agent-runtime/` |
| Agent-control tools (spawn / send / list / close / unseen) | `packages/systems/vt-daemon/src/agent-runtime/agent-control/` |
| Agent status reporting (`agentStatus` / `statusPhrase`) | `packages/systems/vt-daemon/src/agent-runtime/` — cross-cutting, use cgcli |
| `vt` CLI verbs | `packages/systems/voicetree-cli/src/commands/` (`graph/`, `runtime/`, `node/`) |
| Daemon client (CLI ↔ daemon) | `packages/systems/vt-daemon-client/src/` |
| Graph-DB client | `packages/systems/graph-db-client/src/` |
| Graph-DB server | `packages/systems/graph-db-server/src/` (`routes/`, `search/`, `state/`) |
| RPC transport lib (auth token, port discovery) | `packages/libraries/vt-rpc/src/` |
| Daemon / graph protocol + `vt manual` specs | `packages/libraries/vt-daemon-protocol/src/`, `…/graph-db-protocol/src/` |
| Graph model (types, markdown, folders, paths) | `packages/libraries/graph-model/src/` |
| Project paths (root, normalize) | `packages/libraries/paths/src/` |
| Graph schema validation | `packages/systems/voicetree-graph-validation/src/` (+ `…/create-graph/createGraphValidation.ts`) |
| Codebase-health & duplication measures | `packages/measures/src/health/`, `…/src/duplication-*/` |
| Layout quality scoring | `packages/libraries/layout-quality/src/` |
| Webapp shell (UI) | `webapp/src/shell/UI/` |
| Graph rendering (cytoscape) | `webapp/src/shell/UI/cytoscape-graph-ui/` |
| Graph layout algorithms | `…/cytoscape-graph-ui/graphviz/layout/` |
| Webapp host bridge / edge | `webapp/src/shell/edge/` |
| Terminal UI | `webapp/src/core/terminal/` |

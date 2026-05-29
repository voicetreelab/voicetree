# Multi-Vault Routing

How public VT routes `create_graph` writes across loaded vault paths, and how an external workflow author composes those primitives to target a chosen vault.

## Vocabulary

- **writePath**: the single directory the daemon treats as the canonical target for new nodes. Stored per-project in vault config; set by the user via the UI vault selector. Returned by `getMcpWritePath()`.
- **readPaths**: zero or more additional directories that the active view has expanded. Their nodes are loaded into the graph and visible. Returned (alongside the writePath) by `getMcpVaultPaths()` as `[writePath, ...readPaths]`.
- **loaded vault paths**: the union `[writePath, ...readPaths]`. Any path inside this union is considered "in a loaded vault" and is a legal target for `outputPath`.
- **spawnDirectory**: the shell working directory given to a spawned agent's terminal. Set via `spawn_agent.spawnDirectory`. Defaults to the parent terminal's `initialSpawnDirectory` (and ultimately falls back to the project's watched directory).

## Behavior today

### `create_graph.outputPath` resolution

In `packages/systems/vt-daemon/src/create-graph/createGraphTool.ts:resolveOutputDirectory`:

1. **No `outputPath` given** → writes default to the daemon's `writePath`.
2. **Absolute `outputPath`** → resolved as-is, then checked against the loaded vault paths.
3. **Relative `outputPath`** → resolved against the **`writePath`** (not against the agent's CWD), then checked against the loaded vault paths.
4. **Resolved path inside any loaded vault path** → accepted.
5. **Resolved path outside every loaded vault path** → rejected with: `outputPath "<x>" resolves to "<y>" which is outside the loaded vault paths. Choose a path inside one of: <list>`.

### `spawn_agent.spawnDirectory` propagation

In `packages/systems/vt-daemon/src/tools/agent-control/spawnAgentTool.ts:resolveSpawnDirectory`:

- If the caller passes `spawnDirectory`, the child terminal is opened there.
- Otherwise the child inherits the caller's `initialSpawnDirectory` (which the caller itself inherited the same way, all the way back to the agent that was given an explicit value or to the daemon's project root default).

So **`spawnDirectory` inherits across arbitrarily nested spawns**.

### What `spawnDirectory` does NOT do

`spawnDirectory` controls only the agent's shell CWD and a few `VOICETREE_*` env vars. It is **not consulted by `create_graph`**. The `create_graph` default target is always the daemon's `writePath`.

## Verification: 4 scenarios

| # | Scenario | Result | Reasoning |
|---|----------|--------|-----------|
| 1 | Two vaults loaded (project + scratch). Spawn agent with `spawnDirectory: <scratch>`. `create_graph` with no `outputPath`. Expect write into scratch. | **Fail** | `resolveConfiguredOutputDirectory` returns the daemon's single `writePath`. The caller's `initialSpawnDirectory` is not consulted. Writes land in `<project>`. |
| 2 | Same setup; `create_graph` with explicit `outputPath: <scratch>/foo.md`. Expect accepted. | **Pass** | Scratch is in `getMcpVaultPaths()` (as a readPath), so the resolved path satisfies the allowed-vault check. |
| 3 | `create_graph` with `outputPath` outside every loaded vault. Expect rejected with clear error. | **Pass** | Rejection message names the resolved path and lists the loaded vault paths. |
| 4 | Agent A in scratch spawns B without `spawnDirectory`. B calls `create_graph` with no `outputPath`. Expect default into scratch. | **Fail** | Same as (1). `spawnDirectory` inherits correctly (B's CWD is scratch), but `create_graph`'s default still targets the daemon's `writePath`. |

## Public contract

For an external workflow that wants to route writes into a specific loaded vault:

1. **Load the target vault** as either the writePath or as a readPath (UI vault selector, or daemon `addReadPath`).
2. **Pass `outputPath` explicitly** on every `create_graph` call. Prefer an absolute path; relative paths resolve against `writePath`, not the agent's CWD.
3. The resolved path must lie inside one of the loaded vault paths returned by `getMcpVaultPaths()`.

Inside a spawned agent the loaded vault paths are surfaced as:

- `VOICETREE_PROJECT_PATH` — the daemon's `writePath`.
- `ALL_MARKDOWN_READ_PATHS` — newline-separated `[writePath, ...readPaths]`.

A workflow that wants per-agent vault routing currently composes by:

- Choosing the target absolute path in the spawning agent.
- Passing it as `spawn_agent.spawnDirectory` (so the agent's shell CWD matches the routing target — useful for git, file I/O, etc.).
- Passing the same path (or a subdir of it) as `outputPath` on every `create_graph` call inside that agent. The agent can derive this from `process.cwd()` or from an env var the workflow author injects.

## Known gap (no patch this phase)

The default for `create_graph` is the daemon's single `writePath`. It does not fall back to the caller's `initialSpawnDirectory`. This means:

- Every workflow agent that wants writes routed to a non-`writePath` location must pass explicit `outputPath`. There is no implicit "write where I was spawned" mode.
- Relative `outputPath` is resolved against `writePath`, not against the agent's CWD. Agents must pass absolute paths to target other loaded vaults.

The spec for Phase 2 of the Forecast/VT unification plan contemplated promoting `writePath` to `writePaths: string[]` plus an "agent's cwd" fallback in `resolveConfiguredOutputDirectory`. That is **not implemented here**, for two reasons:

1. The current `outputPath` mechanism already permits writing into any loaded vault path; secondary vaults are not read-only at the `create_graph` layer. The gap is about default routing ergonomics, not about reachability.
2. Auto-falling back to the caller's `initialSpawnDirectory` would change the default for existing users whose `spawnDirectory` differs from their configured `writePath` (e.g. a user with `writePath = <project>/Notes/Daily` and an agent spawned at the project root would now have writes land in the project root instead of `Notes/Daily`). A safe roll-out needs an opt-in sentinel or a separate parameter, not a silent default change.

A follow-up phase that needs spawn-context routing should add either:

- a sentinel `outputPath: '@spawnDirectory'` resolved against the caller's `initialSpawnDirectory`, or
- a new explicit parameter (e.g. `routeToSpawnDirectory: true`),

and document it as the supported composition primitive. Either keeps the change generic (no domain vocabulary) and avoids changing the existing default.

# `@vt/graph-db-server`

`@vt/graph-db-server` ships `vt-graphd`, the localhost daemon that owns canonical live state for one vault.

## What The Daemon Owns

- mounted vault root and watcher lifecycle
- read-path and write-path configuration
- parsed in-memory graph snapshot
- server-side session registry
- per-session view state: collapse set, selection, layout, projected live state

The filesystem is still the durable source of truth. `vt-graphd` is the live owner of the in-memory state layered on top of that filesystem.

## Process Model

- one daemon per vault
- loopback-only HTTP on `127.0.0.1`
- dynamic port written to `<vault>/.voicetree/graphd.port`
- single-instance lock at `<vault>/.voicetree/graphd.lock`
- daemon exits cleanly on `SIGINT`, `SIGTERM`, or `POST /shutdown`

## Launch

From this repo checkout, run the bin directly:

```bash
node --import tsx packages/graph-db-server/bin/vt-graphd.ts --vault /abs/path/to/vault
```

Useful flags:

- `--log-level info|debug`
- `--idle-timeout-ms <milliseconds>`

Help:

```bash
node --import tsx packages/graph-db-server/bin/vt-graphd.ts --help
```

Example startup line:

```text
vt-graphd: listening on http://127.0.0.1:<dynamic-port> for vault /abs/path/to/vault
```

## Endpoint Families

### Health and lifecycle

- `GET /health`
- `POST /shutdown`

### Vault control

- `GET /vault`
- `POST /vault/read-paths`
- `DELETE /vault/read-paths/:encodedPath`
- `PUT /vault/write-path`

### Graph snapshot

- `GET /graph`

### Session lifecycle

- `POST /sessions`
- `GET /sessions/:sessionId`
- `DELETE /sessions/:sessionId`

### Session view state

- `GET /sessions/:sessionId/state`
- `POST /sessions/:sessionId/collapse/:folderId`
- `DELETE /sessions/:sessionId/collapse/:folderId`
- `POST /sessions/:sessionId/selection`
- `PUT /sessions/:sessionId/layout`

## How Other Surfaces Use It

### Electron main

- renderer IPC stays stable in v1
- Electron main calls `@vt/graph-db-client`
- main is a proxy, not the source of truth

### CLI entrypoint

- `webapp/src/shell/edge/main/cli/voicetree-cli.ts` routes `vault`, `session`, and `view` commands through `@vt/graph-db-client`
- those commands auto-launch or attach to `vt-graphd`
- they share the same backend behavior as the desktop app
- example:

```bash
node --import tsx webapp/src/shell/edge/main/cli/voicetree-cli.ts vault show --vault /abs/path/to/vault --json
```

### MCP

- graph/live-state MCP tools proxy to `vt-graphd` in v1
- agent-control MCP tools do not move in this phase
- do not document v1 as "MCP moved into the daemon"

## Practical Smoke Commands

These are the commands worth running when checking the daemon path manually:

```bash
node --import tsx packages/graph-db-server/bin/vt-graphd.ts --help
node --import tsx webapp/src/shell/edge/main/cli/voicetree-cli.ts vault show --vault /abs/path/to/vault --json
node --import tsx webapp/src/shell/edge/main/cli/voicetree-cli.ts session create --vault /abs/path/to/vault --json
```

If you use the CLI commands above, they will auto-launch the daemon when needed.

## Related Files

- `packages/graph-db-server/src/server.ts`
- `packages/graph-db-server/src/daemonApp.ts`
- `packages/graph-db-server/src/contract.ts`
- `packages/graph-db-client/src/GraphDbClient.ts`
- `webapp/src/shell/edge/main/cli/commands/vault.ts`
- `webapp/src/shell/edge/main/cli/commands/session.ts`
- `webapp/src/shell/edge/main/cli/commands/view.ts`

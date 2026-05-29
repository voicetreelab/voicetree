# Step 7 Design — Full MCP Removal: UDS daemon, dedicated hook port, spawn-time CLI-manual injection

Status: LOCKED — gate doc for substeps 7b–7g.
Decisions ratified by Lochlan on 2026-05-21. See `step7-decisions-locked.md`
(planning archive) for the original lock entry.

This file is the authoritative reference for the substep implementers
(7b CLI transport, 7c graph-tools live transport, 7d external-MCP-config
removal + spawn-prompt manual injection, 7e hook delivery, 7f HTTP-server
deletion, 7g cleanup). Anything 7b–7g re-litigates should change *here* first.

## 1. Scope and summary

Step 7 deletes every trace of the Model Context Protocol from VoiceTree.
After Step 7 the codebase contains no `@modelcontextprotocol/sdk` import, no
MCP HTTP server, no `.mcp.json` writes, and no MCP protocol concern in any
production file. The CLI verb tree (`vt …`) becomes the only surface that
external coding agents (Claude Code, Codex, OpenCode) and the internal CLI
share. The daemon (`vt-mcpd` for headless, Electron main for desktop) still
owns terminal management, graph state, the chokidar watcher, and the
lifted-but-no-longer-MCP tool catalog — but it speaks a private Unix domain
socket (UDS) instead of HTTP+MCP. Lifecycle hooks fired from inside spawned
agents continue to use `curl` against a tiny dedicated HTTP port that the
daemon binds alongside the UDS socket. Agent discovery is delivered as a
spawn-time prompt injection of `tools/prompts/cli-manual.md`, replacing the
MCP-client tool-description mechanism. Net production delta: −1000 to
−1300 LOC.

## 2. The locked decisions

Each subsection records the decision verbatim in intent, the rationale, and
the alternatives that were rejected (and why). Implementers must not relax
or re-open these without an explicit Lochlan unlock.

### 2.1 Full MCP removal

**Decision.** No Model Context Protocol code remains in VoiceTree after
Step 7: no protocol, no SDK dependency, no `.mcp.json` `type:"http"` entries
written, no MCP server bootstrap. The CLI verb tree is the only surface.

**Rationale.** The CLI manual (Step 6) already gates parity between MCP
tool descriptions and the canonical manual. Once external coding agents
learn `vt` via their Bash tool, the MCP transport is dead weight: a second
protocol surface, an external dependency, and a maintenance burden with no
remaining unique value. Per-CLAUDE.md philosophy: no backward compatibility
shims; remove the flawed layer.

**Rejected: stdio MCP transport.** A stdio MCP server is still MCP — same
protocol semantics, same SDK dependency, same need to maintain the parity
contract. The framing of the question was "fully remove MCP," not "swap
HTTP for stdio."

**Rejected: HTTP rename (keep HTTP, drop MCP framing).** Adds a network
port for no real benefit. UDS is the textbook local-IPC choice; HTTP buys
optionality (remote callers) we explicitly do not want.

**Rejected: no daemon at all.** Spawned-agent PTYs need a stable owner
across CLI invocations. Without a long-lived daemon, terminal management
would need a wholly different model (double-forked agents with PID files,
file-locked registries). Out of scope; the daemon survives, its transport
changes.

### 2.2 `search_nodes` carried over

**Decision.** `search_nodes` becomes a first-class entry in the lifted
tool catalog and is dispatched over UDS like every other tool. The CLI
verb `vt search` is preserved.

**Rationale.** Today `vt search` already exists but routes through
`callMcpTool(port, "search_nodes", …)` against a tool name that is *not*
registered in `registerAllTools()` — it lives at `tools/graph/searchNodesTool.ts`
and was silent drift between Step 6's parity guarantee and reality. Step 7
fixes the drift: the implementation is registered as a normal catalog entry
in `catalog.ts` after 7f and the unregistered-tool-name call is gone.

**Rejected: drop `vt search`.** The verb is used. The drift was an
infrastructure bug, not a feature deprecation.

### 2.3 CLI ↔ daemon transport: Unix domain socket

**Decision.** The internal CLI and `vt graph live` talk to the daemon over
a Unix domain socket. The daemon listens on a per-project socket file; the
CLI process discovers the socket via project-root up-walk (see §3) and writes
length-delimited JSON-RPC over it (see §4). No network port. No HTTP. No
MCP protocol framing.

**Rationale.** UDS is the textbook local-IPC choice on POSIX: no port
allocation, no firewall surface, kernel-enforced same-host isolation, and
filesystem permissions as the trust model. The daemon already owns
per-project state (`graphd.lock`, `graphd.port`); the socket file fits the
same convention. The HTTP MCP server it replaces is 472 LOC of boilerplate
that bought no functional benefit over a 80-LOC `net.createServer`.

**Rejected: stdio MCP transport.** See 2.1.

**Rejected: localhost HTTP with auth tokens.** Adds a network port and a
secret-management problem (token file with restricted permissions —
identical to UDS in security model but with extra moving parts).

**Cross-platform note.** UDS is supported on macOS and Linux (current
shipping targets). Windows requires named pipes (`\\.\pipe\…`) and is **out
of scope for Step 7** — the Electron desktop build does not currently
support Windows production users. If Windows support returns, the
`daemon-client.ts` path-discovery code is the place to add a named-pipe
branch. Flagged as open question §9.4.

### 2.4 Hook delivery: tiny dedicated HTTP port

**Decision.** A second HTTP server on the daemon, built directly on
`http.createServer` (no express, no MCP, no framework), bound only to
`127.0.0.1`, with a single route `POST /hook/:source?terminal=…&event=…`.
Hook scripts running inside spawned agents continue to use `curl` against
this port. The port is published to `<project>/.voicetree/hook.port` at
daemon boot; the spawn pipeline reads that file and injects
`VOICETREE_HOOK_PORT` into spawned-agent environments.

**Rationale.** Hook scripts run in **detached shells** spawned by external
agents (Claude Code, Codex). Their only IPC affordances are tools that
ship with the operating system: `curl` is universal; `nc -U` (UDS-over-`netcat`)
exhibits BSD/GNU divergence and is not portable. The minimum-surface
solution is one tiny HTTP route with `curl`. Two ports total is acceptable
when the second is single-route, fail-quiet, and 50 LOC.

**Rejected: ride the UDS wire.** Hook scripts cannot portably speak UDS.

**Rejected: keep `/hook/:source` on a shared HTTP server.** Defeats the
point — the UDS transport replaces HTTP precisely so the daemon stops
running a 472-LOC HTTP server. Keeping one route alive for hooks justifies
the entire express+MCP-SDK stack.

**Rejected: file-drop hook ingestion (hook writes to `<project>/.voicetree/hooks/`,
daemon watches).** Adds chokidar latency to a path that today is
sub-millisecond. Diagnostic experience (visibility into hook events) is
worse. Not worth the simplification.

### 2.5 Spawn-time prompt injection of the CLI manual

**Decision.** The agent-runtime spawn pipeline injects the content of
`tools/prompts/cli-manual.md` into every spawned coding agent's system
prompt. This is the discovery mechanism for the `vt` CLI; it replaces the
mechanism by which MCP tool descriptions used to reach the agent's MCP
client.

**Rationale.** The agent already needs a startup prompt synthesized at
spawn (context node path, task description, env vars). Adding the CLI
manual to that prompt costs one file read and a string substitution. The
agent then uses its built-in Bash tool to invoke `vt …` directly. No
external transport is involved in discovery.

**Rejected: `CLAUDE.md` / `AGENTS.md` written into the project root only.**
Insufficient for spawned agents — many agent runtimes consume that file
only when the user opens the project, not when an agent is spawned. The
file-in-project path is useful as a *supplement* for user-launched agents
(see R1 in §7) but not as the primary mechanism.

**Rejected: stdio MCP server that re-publishes typed tool definitions.**
See 2.1.

### 2.6 Per-substep commits

**Decision.** Each substep (7a, 7b, 7c, 7d, 7e, 7f, 7g) lands as its own
commit. Intermediate states between 7b/7c/7d/7e and 7f briefly bind both
the old HTTP MCP transport and the new UDS transport on the daemon — this
is the intentional dual-wire window.

**Rationale.** Per-substep commits localize regression risk and let 7b–7e
proceed in parallel (different files, no shared state in flight). 7f is
the irreversible commit; isolating it behind a clean dependency boundary
means a revert touches one commit rather than a sprawling merge.

**Rejected: single mega-commit.** Higher blast radius, longer review,
harder bisect.

## 3. UDS socket-path discovery convention

This section is the authoritative path layout. 7b/7c/7d/7e MUST follow it.

### 3.1 Path table

| Path | Owner | Purpose |
|---|---|---|
| `<project>/.voicetree/vt.sock` | daemon writes; CLI reads | Primary UDS path for CLI↔daemon JSON-RPC |
| `<project>/.voicetree/hook.port` | daemon writes; spawn-pipeline reads | Hook HTTP port number (text file containing the decimal port) |
| `<project>/.voicetree/graphd.port` | already exists; unchanged | Graph-db-server port (out of Step 7 scope) |
| `~/.voicetree/<project-hash>.sock` | fallback if no project is open | Headless `vt` invoked outside any project directory |

Path semantics:

- All UDS paths use the **per-project** location as the canonical primary
  path. `<project>` is the project root directory — same project as discovered by
  the existing `findRepoRoot.ts` up-walk pattern (Step 6 precedent).
- The fallback `~/.voicetree/<project-hash>.sock` exists only for the
  pathological case of `vt …` invoked outside any project directory at all.
  In that case the daemon must have been started with `--project <path>`
  earlier; the CLI hashes the explicit project arg or `$VOICETREE_PROJECT_PATH`
  to find the right socket.
- The hook port file is plain text (`echo "$port"`), not JSON, mirroring
  the existing `.voicetree/graphd.port` shape so callers parse it the same
  way.

### 3.2 Fallback order (CLI side)

When the CLI process starts and needs to talk to the daemon, it resolves
the socket path in this order. First hit wins:

1. **`$VOICETREE_SOCK_PATH` env var.** Explicit override; useful for tests
   and for power users running the daemon out of band. Implementer notes:
   if the env var is set and the file does not exist, the CLI fails fast
   with `DaemonUnreachable` (no further fallback) — the override means
   "trust me, this is where it should be."
2. **`<discovered-project>/.voicetree/vt.sock`.** Project discovery uses the
   same up-walk as `findRepoRoot.ts` (look for `.voicetree/` directory).
3. **`$VOICETREE_PROJECT_PATH/.voicetree/vt.sock`.** Spawned-agent
   environments set this; honour it when set.
4. **`~/.voicetree/<project-hash>.sock`** where `<project-hash>` is
   `sha256(<absolute-project-path>).slice(0,16)`. Last-resort path for
   headless `vt` outside any project tree.

If none of these point at a connectable socket, the CLI fails with the
`daemon_unreachable` error code (§4.3) — never silently retry, never spin
up a daemon ad hoc.

### 3.3 Stale-socket cleanup

A stale socket file is one that exists on disk but has no listening process
behind it (e.g. daemon crashed). The daemon-side bootstrap MUST handle this
defensively:

- On `vt-mcpd` start, before `net.createServer().listen(path)`, the daemon
  checks for an existing `vt.sock`. If present, the daemon attempts a
  zero-byte connect; if connect succeeds, another daemon owns the socket
  and the new daemon aborts (single-owner contract — same as the existing
  `graphd.lock`).
- If the connect fails with `ECONNREFUSED` or `ENOENT`, the daemon
  unlinks the stale socket file and proceeds to bind.
- The CLI side does NOT clean up stale sockets — it surfaces
  `daemon_unreachable` and exits. Cleanup is exclusively the daemon's
  responsibility (single writer, no race).

### 3.4 Daemon-boot atomicity

A spawned agent that calls `curl http://localhost:$VOICETREE_HOOK_PORT/hook/…`
the instant it boots can race the daemon's hook-port write. To avoid this:

- The daemon's startup sequence binds the UDS socket AND the hook HTTP
  port BEFORE writing either path file.
- Both `vt.sock` and `hook.port` are written **atomically** (write to
  temp + `fs.renameSync`) once both servers report listening.
- The daemon does not spawn agents (via `vt agent spawn`) before its own
  startup is complete. The CLI's `vt agent spawn` reads the hook port
  file *after* the daemon-side spawn has completed; by then both files
  exist.

This eliminates the documentable race: any agent that observes a
`VOICETREE_HOOK_PORT` env var also has a binding listener on that port.

## 4. Wire-level shape: JSON-RPC over UDS

This section pins the on-wire contract so 7b and 7c speak the same dialect.

### 4.1 Envelope

The wire is JSON-RPC 2.0. One request and one response per RPC. The
request shape is:

```
{ "jsonrpc": "2.0", "method": "<tool_name>", "params": { … }, "id": <number> }
```

`<tool_name>` is the catalog name: `spawn_agent`, `list_agents`,
`wait_for_agents`, `get_unseen_nodes_nearby`, `close_agent`, `send_message`,
`read_terminal_output`, `create_graph`, `graph_structure`,
`vt_get_live_state`, `vt_dispatch_live_command`, `search_nodes`. (Twelve
entries after Step 7 — the eleven from `registerAllTools` plus the
formerly-unregistered `search_nodes`. See §2.2.)

The success-response shape is:

```
{ "jsonrpc": "2.0", "result": { … }, "id": <number> }
```

The error-response shape is:

```
{ "jsonrpc": "2.0", "error": { "code": <number>, "message": "<string>", "data": { … } }, "id": <number> }
```

`data` is optional but RECOMMENDED for any error a caller might recover
from; in particular `validation_failed` errors MUST include the structured
schema-violation envelope in `data` (see §4.4).

### 4.2 Framing

**Decision: newline-delimited JSON (NDJSON).** Each request and each
response is a single JSON object terminated by `\n`. No length prefix, no
HTTP-style headers, no chunked encoding.

**Rationale.** Simplest readable wire; trivial to inspect with
`socat - UNIX-CONNECT:vt.sock`. The peak payload today is `create_graph`
in batch mode, which is bounded by user input and stays well under the
default Node socket buffer (16 KiB). No payload streaming case exists in
the catalog.

**Risk + mitigation.** If a future tool requires a multi-megabyte payload
(image attachments, large graph snapshots), NDJSON's single-line constraint
becomes brittle (a 4 MiB JSON line is technically fine but a forgotten
embedded newline corrupts framing). The fix is length-prefixed framing
(`<u32-length-be>\n<json-bytes>`), localized to the framing layer of
`daemon-client.ts` and `udsServer.ts`. Both files MUST keep framing in a
single helper function for ease of future swap. Not done now to avoid
preemptive complexity.

### 4.3 Error codes

JSON-RPC reserves codes `-32700` to `-32600` for protocol errors. VoiceTree
adds an application-error range starting at `-32000` (also reserved by the
spec for server-defined errors). All codes are `number`-typed on the wire,
but each has a stable string alias used in error envelopes' `data.kind`
field for log-grep-ability.

| Code | Kind alias | Meaning |
|---:|---|---|
| `-32700` | `parse_error` | Malformed JSON arrived at the daemon |
| `-32600` | `invalid_request` | JSON parsed but does not conform to JSON-RPC 2.0 |
| `-32601` | `tool_not_found` | `method` does not match any catalog entry |
| `-32602` | `validation_failed` | `params` failed the catalog entry's zod schema; `data` carries the structured schema-violation envelope (see §4.4) |
| `-32603` | `internal_error` | Unexpected exception in a tool handler |
| `-32000` | `daemon_unreachable` | CLI-side synthetic error: no daemon bound to the expected socket. NOT emitted by the daemon. |
| `-32001` | `renderer_required` | Live tool invoked against a daemon without a renderer (headless `vt serve`) |
| `-32002` | `caller_terminal_unknown` | Write tool invoked without a valid `callerTerminalId` (existing contract; see `docs/headless-migration.md`) |
| `-32003` | `tool_handler_failed` | Catalog handler returned a domain-level failure (e.g. agent already closed) — `data` carries handler-specific structured info |

Future codes added in this range MUST be documented here.

### 4.4 The CLI-layer error envelopes survive

Two error envelopes that today ride out of the HTTP MCP transport via
stderr SHALL continue unchanged after Step 7:

- **`{ "kind": "schema_violation", "rule_id": "…", "rationale": "…", "remediation": "…", "overridable": <bool>, "override_hint"?: "…" }`** — emitted by `vt graph create` when the schema gate rejects a node. Step 3 wired the `--override` flag's `override_hint`; Step 5's BatchReport work makes this a structured field on the batch report. The envelope lives at the CLI layer (it is what `vt graph create` prints to stderr), not at the JSON-RPC layer. The JSON-RPC `validation_failed` error's `data` field carries the same envelope so internal callers receive a structured shape rather than the stderr text.
- **`{ "kind": "graph_create_batch_result", "accepted": [...], "rejected": [...] }`** — Step 5's batch envelope. Same story: CLI-layer over the wire, also surfaced inside `data` for structured consumers.

Implementers (7b, 7c) MUST verify these envelopes round-trip cleanly when
swapping the wire — the forecasting retry path consumes them and must
continue to work.

### 4.5 Connection lifecycle

- One request per connection. The CLI opens the socket, writes one
  NDJSON request, reads one NDJSON response, closes. No connection reuse.
  Avoids head-of-line blocking, simplifies the server.
- Server-side: each accepted connection is handled in an independent
  async dispatch. No mutex; tools that need exclusion (e.g. write paths
  through the graph-store) inherit it from the underlying tool
  implementation, not from the wire.
- Timeouts: the CLI side imposes a 30-second default response timeout
  (long enough for `vt agent spawn` to complete an LLM warm-up; short
  enough that a hung daemon is diagnosed quickly). Configurable via
  `$VOICETREE_DAEMON_TIMEOUT_MS`.

## 5. What dies / what lives

Tables, not prose. Paths are repo-relative.

### 5.1 Files deleted

| File | LOC | Removed in |
|---|---:|---|
| `packages/systems/voicetree-mcp/src/tools/agent-control/mcp-server.ts` | 472 | 7f |
| `packages/systems/voicetree-mcp/src/tools/live/registerLiveTools.ts` | 46 | 7f |
| `webapp/src/shell/edge/main/cli/manual/cliManualParity.test.ts` | 100 | 7f |
| `webapp/src/shell/edge/main/cli/manual/extractZodDescriptions.ts` | 74 | 7f |
| `webapp/src/shell/edge/main/cli/mcp-client.ts` (in current form) | 104 | 7b (rewrite) / 7g (orphan sweep) |
| `packages/libraries/graph-tools/src/live/liveTransport.ts` (HTTP variant) | 128 | 7c (rewrite) / 7g (orphan sweep) |
| `packages/systems/voicetree-mcp/src/config/mcp-client-config.ts` (bulk) | ~300 of 334 | 7d |
| `packages/systems/voicetree-mcp/src/tools/agent-control/hookEventHandler.ts` | 63 | 7e (moved to `hooks/`) / 7g if orphaned |
| `packages/systems/voicetree-mcp/src/tools/agent-control/hookEventMapping.ts` | 63 | 7e (moved to `hooks/`) / 7g if orphaned |

### 5.2 Files created

| File | LOC (target) | Created in |
|---|---:|---|
| `webapp/src/shell/edge/main/cli/daemon-client.ts` (replaces `mcp-client.ts`) | +80 to +130 | 7b |
| `packages/libraries/graph-tools/src/live/udsLiveTransport.ts` (replaces HTTP `liveTransport.ts`) | +70 to +110 | 7c |
| `packages/systems/voicetree-mcp/src/config/stripStaleVoicetreeMcpEntries.ts` | +30 | 7d |
| `packages/systems/voicetree-mcp/src/hooks/hookHttpServer.ts` | +50 | 7e |
| `packages/systems/voicetree-mcp/src/tools/catalog.ts` (lifted from `mcp-server.ts`) | ~170 (moved, not net new) | 7f |
| `packages/systems/voicetree-mcp/src/transport/udsServer.ts` | +80 to +130 | 7f |
| `packages/systems/tool-catalog/tests/catalogManualDrift.test.ts` (replaces deleted `cliManualParity.test.ts`; substring-match each `catalog.ts` description against the rendered manual) | ~30 | 7g |

### 5.3 Files modified (non-trivially)

| File | Change | Modified in |
|---|---|---|
| `webapp/src/shell/edge/main/cli/voicetree-cli.ts` | Remove `--port` / `$VOICETREE_MCP_PORT` plumbing from `GlobalOptions` (keep `$VOICETREE_HOOK_PORT`) | 7b |
| `webapp/src/shell/edge/main/cli/commands/runtime/agent.ts` etc. | `callMcpTool(port, …)` → `callDaemon(…)` rename | 7b |
| `packages/systems/agent-runtime/src/application/spawn/agentHookInjection.ts` | URL `$VOICETREE_MCP_PORT` → `$VOICETREE_HOOK_PORT` | 7e |
| `packages/systems/agent-runtime/src/application/spawn/` (prompt synth) | Inject `tools/prompts/cli-manual.md` into spawn prompts | 7d |
| `packages/systems/voicetree-mcp/bin/vt-mcpd.ts` | Replace `startMcpServer()` with UDS daemon + hook-port startup; delete the `--port` flag entirely (no replacement — UDS path is derived from `--project`, hook port is auto-assigned) | 7f |
| `webapp/src/shell/edge/main/runtime/electron/app/main.ts` | Same swap on the desktop bootstrap path | 7f |

### 5.4 Package rename in 7g

After Step 7 the `@vt/vt-daemon` package contains zero MCP code; its
name is the only "MCP" reference left in the codebase. 7g renames the
package to **`@vt/tool-catalog`** to fix the misleading label. The rename
is the last action in 7g (after all other deletions and the dependency
audit) and covers:

- `packages/systems/voicetree-mcp/` → `packages/systems/tool-catalog/`
  (directory rename)
- `package.json` `name` field: `@vt/vt-daemon` → `@vt/tool-catalog`
- Every import in the repo: search/replace `@vt/vt-daemon` →
  `@vt/tool-catalog`
- The `vt-mcpd` binary name: TBD by the 7g implementer — recommend
  renaming the script entry to `vt-toold` or leaving the binary name
  alone if the user-facing impact is high. The binary is invoked by
  Electron / scripts, not by end users directly.
- `package-boundaries.test.ts` and any other test referencing the old
  package name.

Rationale (Lochlan-ratified 2026-05-21): the package's role is the *RPC
layer* between short-lived CLI processes and the long-lived daemon —
distinct from `@vt/graph-db-server` (graph state primitive) and
`@vt/agent-runtime` (terminal runtime primitive). It hosts the tool
catalog plus its two transport servers (UDS + hook HTTP). "tool-catalog"
matches that role; "voicetree-mcp" no longer does. Splitting the package
further was considered and rejected — too much boilerplate for ~500 LOC
of coherent transport-layer code.

### 5.5 What lives unchanged

- All eleven tool *implementations* under `packages/systems/voicetree-mcp/src/tools/`
  (`spawnAgentTool`, `createGraphTool`, etc.). The catalog binds the same
  functions; only the transport changes.
- `tools/graph/searchNodesTool.ts` is registered as a first-class catalog
  entry instead of being called by an unregistered name (§2.2).
- `tools/prompts/cli-manual.md` — load-bearing as the canonical manual,
  now also load-bearing as the spawn-prompt injection source.
- The `vt-mcpd` binary identity. It still owns graph-state, chokidar
  watcher, terminal registry, and the per-project lock — its transport
  changes, its role does not.
- Electron desktop terminal flow. Renderer-side IPC is unaffected; only
  the in-process transport between Electron main and the tool catalog
  changes (and in fact Electron main may bypass UDS entirely and call
  catalog handlers in-process — see 7f's notes).
- The Step 5 BatchReport envelope. Step 7 does not touch
  `webapp/.../commands/graph/actions/create.ts`, `schemaGate.ts`,
  `filesystem.ts`, or `core/types.ts`.

## 6. Substep dependency graph

```
                     ┌────► 7b (CLI UDS client) ────────┐
                     │                                   │
   7a (this doc) ────┼────► 7c (live-tool UDS client) ──┤
                     │                                   ├──► 7f (delete HTTP MCP server, lift catalog) ──► 7g (orphan sweep + dep audit)
                     ├────► 7d (kill .mcp.json writes,   │
                     │       inject CLI manual into       │
                     │       spawn prompts) ──────────────┤
                     │                                   │
                     └────► 7e (hook HTTP port) ─────────┘
```

Equivalent textual form:

- `7a → {7b, 7c, 7d, 7e}` — 7b through 7e may proceed in parallel after
  7a's design is committed. They touch disjoint files and operate against
  the still-running HTTP MCP server (intentional dual-wire window).
- `{7b, 7c, 7d, 7e} → 7f` — 7f is the irreversible commit: deletes
  `mcp-server.ts` and friends, lifts the catalog, wires the UDS server. All
  four predecessors must be in place.
- `7f → 7g` — 7g is the post-deletion sweep: typecheck identifies orphans,
  the `@modelcontextprotocol/sdk` dependency drops out of both
  `package.json` manifests, the package-boundaries test re-validates.

The dual-wire window between 7b/7c landings and 7f IS intentional. During
that window the daemon binds BOTH the HTTP MCP server (for any consumer
not yet migrated) AND the UDS socket (for the migrated CLI). 7f closes the
HTTP wire.

## 7. Residual risks

Cho's risk register, kept verbatim in intent. R3 has been resolved by §3
of this document and is dropped from the residual set.

### R1 — User-launched coding agents in a project

**Risk.** Spawn-time prompt injection (2.5) reaches only agents that VT
itself spawns. A user who opens Claude Code (or Codex, or another coding
agent) directly in their project — without going through `vt agent spawn`
— never sees the manual injection. Today, that user-launched agent reads
`.mcp.json` and discovers VoiceTree's tools automatically. After Step 7,
the agent has no discovery surface.

**Mitigation (recommended for 7d).** At project open, write a
`CLAUDE.md` / `AGENTS.md` addendum into the project root advertising the
`vt` CLI. Suggested implementation:

- If `<project>/CLAUDE.md` exists, append a fenced VoiceTree section
  (idempotent — re-running does not duplicate).
- Else create `<project>/.voicetree/AGENTS.md` containing the same content
  and symlink (or include via `@`) from a generated `<project>/CLAUDE.md`.
- Content: the same `tools/prompts/cli-manual.md` body, with a banner
  identifying VoiceTree as the source.

**Severity.** Medium. Misses a real user flow but is a follow-up; the
primary flow (VT-spawned agents) is covered by 2.5. Not blocking 7f.

### R2 — Stringly-typed CLI invocation vs structured tool calls

**Risk.** Today, a coding agent invokes an MCP tool with typed
arguments (`{ nodeId: "/path", task: "…" }`) that its MCP client
validates. After Step 7, the same agent writes a bash string
(`vt agent spawn --node "/path" --task "…"`) that its Bash tool runs.
Opus + Sonnet handle stringly-typed invocations reliably; Haiku and
smaller models may make more mistakes (mis-quoted args, wrong verb order,
missing flags).

**Mitigation.** Two prongs already in flight:

- A clear, comprehensive `cli-manual.md` (Step 6) is now load-bearing as
  the discovery surface. The manual lists every verb, every flag, every
  error envelope.
- Machine-parsable stderr envelopes (`schema_violation`,
  `graph_create_batch_result` from Step 5) make agent self-correction
  feasible — the agent reads its own failure mode and retries.

**Severity.** Low for Opus / Sonnet workloads; unknown for smaller
models. The remediation if a measured regression emerges is a
spawn-template revision (better few-shot examples in the manual
injection), not a transport revert.

## 8. Migration order constraints

These are the cross-substep ordering rules. Substep implementers must not
violate them; the orchestrator (Ari) enforces them when sequencing.

1. **Reviewer-MINOR cleanup lands before Step 7 begins.** Lochlan
   authorized this. Specifically: the `OVERRIDABLE_RULE_IDS` move, the
   `findRepoRoot` marker swap, stdin cast hardening, and the
   `extractZodDescriptions` ordering fix. The `extractZodDescriptions` fix
   is moot once 7f deletes the file, but the `OVERRIDABLE_RULE_IDS` move
   pulls in code Step 7 will want to touch, so doing it first avoids
   merge churn.

2. **7a (this doc) is the first Step 7 commit.** No implementer should
   start 7b–7g until this doc is on disk. Anything ambiguous is fixed
   here, not in the implementer's commit.

3. **7b, 7c, 7d, 7e may land in any order, in parallel.** They touch
   disjoint files. The orchestrator decides scheduling.

4. **7f is the irreversible commit.** It deletes `mcp-server.ts` and the
   HTTP transport. All of {7b, 7c, 7d, 7e} must be on `dev-lochlan`
   first. Reverting 7f requires reverting in reverse: 7f → revert,
   then unwinding 7b/7c/7d/7e as needed. Treat 7f as a one-way door.

5. **7g is the final sweep.** Runs after 7f's tests are green. Deletes
   orphan files surfaced by typecheck, removes
   `@modelcontextprotocol/sdk` from `package.json` of both
   `voicetree-mcp` and `graph-tools`, audits the residual `mcp` references
   in the codebase for stale comments. Trivially reversible.

6. **7d's stale-entry migrator MUST run on first project open after the
   user upgrades to a post-7f build.** Otherwise the user's existing
   `.mcp.json` / `.codex/config.toml` / `opencode.jsonc` files contain a
   `voicetree` MCP entry pointing at a port that no longer binds; the
   external coding agent attempts to connect, fails, and surfaces a
   confusing error. The migrator strips the stale entry and the agent
   falls back to its own (now manual-injection-based) discovery. This
   constraint applies whether or not 7d landed in the same release as 7f
   — but landing 7d before 7f is preferred because it eliminates the
   window in which a project open writes a stale entry that the same
   binary then refuses to serve.

## 9. Clarifications ratified during 7a drafting

Items 7a noticed during drafting that the locked-decisions document
(`step7-decisions-locked.md`) did not lock. Each was surfaced to Lochlan
and ratified on 2026-05-21. Recorded here for audit; the substantive
content lives in the body sections referenced.

### 9.1 `vt-mcpd --port` flag: DELETE entirely

The `--port <n>` argument to `vt-mcpd` is removed in 7f. No replacement
flag — the UDS path is derived from `--project`, and the hook HTTP port
is auto-assigned (and published to `<project>/.voicetree/hook.port`). Per
CLAUDE.md "no backwards compatibility": no alias, no deprecation
warning. See §5.3 row for `bin/vt-mcpd.ts`.

### 9.2 Wire framing: NDJSON locked

§4.2 records the locked choice: NDJSON. The framing helper MUST be
isolated in `daemon-client.ts` and `udsServer.ts` so a future swap to
length-prefixed framing (if a multi-megabyte payload tool emerges) is
mechanical.

### 9.3 7g lightweight catalog ↔ manual drift check: ADD

The 7g sweep adds a lightweight test that loads `catalog.ts` and
asserts each tool's `description` string appears as a substring in the
rendered manual produced by `vt manual`. Replaces the 100-line
`cliManualParity.test.ts` that 7f deletes. Target ~30 LOC. Catches
outright deletion drift between the catalog (load-bearing data) and the
manual (load-bearing as both canonical docs and spawn-prompt injection
source).

### 9.4 Windows: OUT OF SCOPE

§2.3 records this. Current Electron production targets are macOS +
Linux. If Windows support returns, the named-pipe branch goes into
`daemon-client.ts`'s path-resolution code. Release notes (post-7f)
should call out "Windows not supported" for clarity.

### 9.5 Package rename: `@vt/vt-daemon` → `@vt/tool-catalog` in 7g

§5.4 records the full rename plan. Rationale: after Step 7 the package
contains zero MCP code; its role is the RPC layer between CLI and
daemon (catalog + UDS server + hook HTTP server). "tool-catalog"
matches that role; "voicetree-mcp" no longer does. Splitting further or
merging into existing packages was considered and rejected (layering
mismatch).

---

End of design. Implementers (7b–7g): if you find yourself making a
decision that this document does not answer, surface it as a new open
question rather than baking your call into a commit.

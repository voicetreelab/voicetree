# Step 9 Design — HTTP transport, WSL topology, bearer auth, WebSocket subscriptions

Status: LOCKED — gate doc for substeps 9b–9g.
Decisions ratified by Lochlan on 2026-05-22 after the Step 7 end-of-flight
synthesis. See `mcp-to-cli-end-of-flight-synthesis.md` for the retrospective
and `docs/step7-design.md` for the predecessor design doc.

This file is the authoritative reference for the substep implementers
(9b HTTP server + auth + subscription hub, 9c CLI HTTP client, 9d
graph-tools HTTP client, 9e renderer subscription client, 9f tmux-relay
fold, 9g cleanup). Anything 9b–9g re-litigates should change *here* first.

## 1. Scope and summary

Step 9 swaps the CLI↔daemon wire from UDS to plain HTTP, adds a
shared-secret bearer auth token, and introduces a WebSocket subscription
channel for live updates. The three daemon listeners that Step 7
produced (UDS for CLI, dedicated hook HTTP server, dedicated tmux
WebSocket relay) collapse into a single HTTP server with four routes.

Step 9 is driven by Windows topology. Step 7 explicitly scoped Windows
out (`step7-design.md` §2.3, §9.4) because UDS does not cross the
WSL2/Windows boundary. Bringing Windows back requires a network-capable
transport; HTTP is the textbook choice. The Electron app runs as a
native Windows process; the daemon (`vt-mcpd`) runs inside the user's
WSL2 distro on the same physical machine. The wire crosses the WSL
bridge.

The renderer needs a live push channel for chokidar watcher events.
Today the chokidar watcher lives in Electron main and pushes to the
renderer via in-process IPC. Under Step 9 the daemon owns the watcher
and lives across the WSL bridge from Electron main; in-process IPC is
no longer available. WebSocket is the chosen push channel.

What Step 9 preserves from Step 7: no MCP, no `@modelcontextprotocol/sdk`
dependency, tool catalog as pure data (`tools/catalog.ts`),
spawn-time prompt injection for agent discovery, the twelve catalog
entries with zod-validating dispatch, CLI-layer error envelopes
(`schema_violation`, `graph_create_batch_result`) riding through error
`data`, per-substep commits.

What Step 9 changes: wire (UDS → HTTP), auth (filesystem permissions →
bearer token), bind (`127.0.0.1` → `0.0.0.0`), listener count
(three → one), renderer push channel (in-process IPC → WebSocket).

LOC budget. Step 7's synthesis named the pattern: wire/protocol
substeps came in 3–5× Cho's estimates. The §5 estimates below carry a
3× pad. Implementers MUST STOP-and-surface if they blow even the
padded estimate. Honest LOC counting is non-optional.

## 2. The locked decisions

Ten decisions, ratified by Lochlan 2026-05-22. Each subsection records
the decision verbatim in intent, rationale, and rejected alternatives.
Do not relax or re-open without an explicit Lochlan unlock.

### 2.1 Transport: plain HTTP, JSON-RPC 2.0 in body

**Decision.** The daemon binds one HTTP server using Node's built-in
`http.createServer`. No Express, no framework. CLI and graph-tools send
JSON-RPC 2.0 envelopes as HTTP POST bodies to `/rpc`. Wire shape pinned
in §4.

**Rationale.** UDS does not cross the WSL2/Windows boundary. HTTP is
the only locally-portable transport that does. Node's built-in `http`
is sufficient for the load (one daemon, one user, low QPS) and costs
zero dependencies.

**Rejected: re-introduce MCP / SDK.** Step 7 deleted MCP for substantive
reasons. Not re-opened.

**Rejected: gRPC.** Code-gen step, runtime dependency, binary on-wire
format. Not justified at this QPS.

**Rejected: split wires (UDS for CLI, HTTP for renderer).** Doubles the
framing helpers and the auth surface. Cycle-forced duplication is
already an open item (synthesis §4.1); a second wire amplifies it.

### 2.2 Windows topology: WSL only

**Decision.** Daemon runs only inside the user's WSL2 distro. Windows
users run the Electron app as a native Windows process; the daemon
lives one bridge-hop away. macOS and Linux users run the daemon
natively. No native Windows daemon. No named-pipe branch.

**Rationale.** Native Windows daemon would require Windows-native
parity for `chokidar`, `node-pty`, and `tmux` (which doesn't exist on
Windows). WSL2 sidesteps these. Per CLAUDE.md "no backward-compat
shims": no Windows-native code path.

**Rejected: ship a native Windows daemon.** Weeks of work for tmux
parity alone.

**Rejected: support WSL1.** Different networking model. Step 9 targets
WSL2 only.

### 2.3 Bind interface: `0.0.0.0` by default

**Decision.** The HTTP server binds `0.0.0.0` (all interfaces).
Configurable via `$VOICETREE_DAEMON_BIND` but the default is
`0.0.0.0`. The auth token (§2.4) becomes load-bearing — the only thing
between an arbitrary LAN host and the daemon's tool surface.

**Rationale.** Older WSL2 versions (pre-mirrored-mode) do not mirror
`127.0.0.1` from the Linux side back to Windows. Windows-side
Electron reaches the daemon via the WSL2 distro's IP. Binding only
`127.0.0.1` breaks the cross-bridge case on those WSL2 builds.

Modern WSL2 with `networkingMode=mirrored` does mirror loopback; on
those hosts `127.0.0.1` would suffice. We do not fork bind behaviour
on WSL2 version — detection is fragile and the auth token makes
`0.0.0.0` safe.

**Rejected: `127.0.0.1` + documented WSL2 networking-mode prereq.**
Pushes a Windows-config burden onto the user with no debuggable error.

**Rejected: bind only the WSL bridge interface.** Detecting that
interface portably is the same fragility as version detection.

### 2.4 Auth: shared-secret bearer token

**Decision.** The daemon generates a 32-byte cryptographically random
token at startup (`crypto.randomBytes(32).toString('hex')`, 64 hex
chars). Token is written to `<project>/.voicetree/auth-token` with mode
`0600`. Clients send `Authorization: Bearer <token>` on every HTTP
request and on the initial WebSocket upgrade. Daemon rejects bad
tokens with HTTP `401`, empty body. WebSocket upgrades with bad
tokens are rejected with `401` *before* completing the WS handshake.

**Rationale.** `0.0.0.0` exposes the daemon to anything that can route
to the host. The token gates the wire; mode `0600` gates the token.
Filesystem permissions remain the trust root, at one level of
indirection.

Threat: another local user reading the token file. Mitigated by
`0600` — only the owning user can read. Cross-user project access is
out of the threat model.

**Rejected: no auth.** Anything on the LAN could call `vt agent
spawn` (which executes shell). Hard veto.

**Rejected: mTLS or HMAC-per-request.** Real security gains, but
deployment-complexity cost not warranted for the threat model
(loopback + WSL bridge, no remote callers).

**Rejected: periodic rotation.** Adds reconnection churn for no
defended threat. Daemon-restart is the only invalidation event
(§2.8).

### 2.5 Single HTTP server, four routes

**Decision.** ONE HTTP server bound to `0.0.0.0:<port>`. Four routes:

| Method | Path                       | Purpose                                          |
|--------|----------------------------|--------------------------------------------------|
| `POST` | `/rpc`                     | Tool catalog dispatch (JSON-RPC 2.0).            |
| `POST` | `/hook/:source`            | Agent lifecycle hooks (Step 7e contract).        |
| `GET`  | `/events`                  | WebSocket upgrade — subscription channel.        |
| `GET`  | `/terminals/:id/attach`    | WebSocket upgrade — tmux relay (folded in 9f).   |

Unknown routes return `404`. `OPTIONS` returns `204`, empty body (no
CORS preflight — bearer token gates everything regardless).

**Rationale.** Step 7's daemon ended up with three listeners by
accretion. Step 9 consolidates because HTTP subsumes all three. One
listener is one port to publish (§2.7) and one auth surface to audit.

**Rejected: split `/hook/:source` to its own port.** Step 7e split
specifically because hook scripts couldn't speak UDS. With HTTP that
constraint vanishes.

**Rejected: split tmux relay from `/rpc`.** Same. With the rest on
HTTP, the relay is just another WS route. 9f folds it.

### 2.6 Live events: WebSocket subscription channel on `/events`

**Decision.** The renderer (and any other live consumer) opens a
WebSocket to `GET /events` with the bearer token in the
`Authorization` header. After the handshake the client sends
`subscribe` frames listing topics; the server pushes JSON event
frames keyed by topic. Wire shape pinned in §4.3.

Initial topic taxonomy: `agent-lifecycle` (from `/hook/:source`
ingestion). vt-graphd is the canonical owner of the mounted watcher;
this hub publishes `agent-lifecycle` only (per
`docs/daemon-first-architecture.md`). Additional topics may be added
without re-litigating the wire — adding a topic is server-side only;
subscribers that don't subscribe are unaffected.

**Server-side buffering.** The server keeps a bounded per-topic resume
buffer of the **most recent 100 events**. Each pushed event carries a
monotonic per-topic `seq` (daemon-lifetime; resets on restart). On
reconnect (§2.9) the client may request resume from a `seq`; if in
buffer, the server replays from there. Otherwise: `gap` frame and the
client re-synchronizes via `/rpc`.

**Per-subscriber send buffer.** Bounded outbound queue (target: 1 MiB
or 1000 events). On overflow the server drops the slow consumer with
WebSocket close `1011 overflow`. Client treats as transient disconnect
and reconnects.

**Rationale.** WebSocket on the same port as `/rpc` keeps the wire
count to one and the auth surface to one. Bounded resume covers
transient disconnects without requiring full state re-sync.

**Rejected: long-poll on `/rpc`.** Doubles HTTP framing cost per
event; saturates one HTTP connection per subscriber.

**Rejected: SSE.** Comparable to WebSocket server→client, but client
needs a side channel for `subscribe`/`unsubscribe`. WS is one
connection both ways.

**Rejected: per-topic separate connections.** N reconnects, N times
the auth handshake. Multiplexing is simpler.

### 2.7 Port discovery

**Decision.** Daemon writes its port to `<project>/.voicetree/rpc.port`
as plain text (decimal integer + `\n`). Clients (CLI, graph-tools,
renderer) resolve the URL via this chain, first hit wins:

1. **`$VOICETREE_DAEMON_URL`** — full URL including scheme/host/port
   (e.g. `http://172.21.0.1:51337`). Spawned-agent shells get this
   injected at spawn time. Highest priority — explicit override.
2. **`<discovered-project>/.voicetree/rpc.port`** — project discovered by
   the `findRepoRoot.ts` up-walk (Step 6 / Step 7 precedent). Host
   default depends on platform (§3.2 — `127.0.0.1` for native,
   WSL2-aware on Windows).
3. **`$VOICETREE_PROJECT_PATH/.voicetree/rpc.port`** — fallback for
   CLI invocations outside a project directory.
4. None resolve → fail fast with `daemon_unreachable` (§4.6).

The auth token lives at `<project>/.voicetree/auth-token` at the same
project location. Clients that resolve via `$VOICETREE_DAEMON_URL` also
need `$VOICETREE_AUTH_TOKEN` injected; the spawn pipeline sets both
(§5.3).

Step 7's `hook.port` file is deleted in 9b — one listener, one port
file. Atomic publish: bind with port 0, read back via
`server.address()`, write the port file via temp + `fs.renameSync`.
Token file written the same way.

### 2.8 Token rotation: daemon-restart-invalidates only

**Decision.** Daemon generates a fresh token on every startup. Token
file is overwritten atomically. No timed rotation, no manual rotation
endpoint, no revocation list. Clients with stale tokens get `401`,
re-read the file, reconnect.

**Rationale.** The token gates the LAN-exposed bind. The threat
model (loopback + WSL bridge, no remote callers) does not benefit
from time-bound rotation.

**Rejected: persist tokens across restarts.** Adds a
secret-lifecycle concern with no defended threat. Removes our
simplest invalidation event.

### 2.9 WebSocket reconnect: exponential backoff with jitter

**Decision.** Client implements exponential backoff: base 1s, max
30s, **full jitter** (each attempt's delay is `random(0, current_max)`
where `current_max` doubles up to the 30s ceiling). On successful
reconnect the client either:

- **Resume**: include last-seen `seq` per topic in `subscribe`. If
  the server's buffer contains that `seq`, replay from there.
- **Resnapshot**: on `gap` from the server, treat the subscription
  as fresh — re-fetch state via `/rpc`, continue forward.

Bounded resume buffer (§2.6): ~100 events/topic, covering ~5s of
chokidar at peak rates before resnapshot is required.

**Rationale.** Standard backoff pattern. Full jitter avoids
thundering-herd on shared reconnect events (daemon restart).

**Rejected: fixed retry interval.** Doesn't degrade under outage.

**Rejected: server-side durable queues.** Out of scope; renderer
state is recoverable from `/rpc`.

### 2.10 Per-substep commits; no dual-wire window

**Decision.** 9a (this doc), 9b, 9c, 9d, 9e, 9f, 9g each land as one
commit. 9b deletes every UDS server-side file *in the same commit*
that adds the HTTP server. There is no transitional window where the
daemon binds both wires. 9c rewrites the CLI client to HTTP; the
orchestrator sequences 9b and 9c so `dev-lochlan` is never in a
state where the CLI can't talk to the daemon.

**Rationale.** Step 7's dual-wire window served external callers
(`.mcp.json` consumers) the orchestrator could not migrate
atomically. Step 9 has no such callers: every UDS client is in-repo.
Worse, UDS *cannot* serve Windows; a dual-wire window still leaves
Windows broken.

**Rejected: dual-wire mirroring Step 7's pattern.** No benefit, real
cost (two test matrices, two failure modes).

**Rejected: feature flag controlling wire choice.** Per CLAUDE.md —
no feature flags or backwards-compatibility shims.

## 3. Network topology and WSL bridge

### 3.1 macOS / Linux native

Electron, daemon, and CLI run on the same kernel. HTTP binds
`0.0.0.0:<port>` (uniform across platforms for simplicity); clients
dial `http://127.0.0.1:<port>`. Auth token gates the wire. The
LAN-exposure threat (§7 R5) applies on a shared/hostile LAN.

Clients without `$VOICETREE_DAEMON_URL` construct
`http://127.0.0.1:<port>` from the port file.

### 3.2 Windows + WSL2

Daemon inside WSL2; Electron native Windows. Two networking modes:

**Mirrored** (`networkingMode=mirrored` in `.wslconfig`,
Windows 11 22H2+). WSL2 shares the host's loopback; `127.0.0.1`
works from both sides. Windows clients construct
`http://127.0.0.1:<port>` from the port file (read via
`\\wsl$\<Distro>\<project-path>\.voicetree\rpc.port`).

**NAT** (legacy default). Loopback not mirrored. Windows clients
reach the daemon via the WSL2 distro's IP. Discovery:

- Read port + token via the `\\wsl$\` UNC namespace.
- Resolve daemon URL via `wsl.exe hostname -I` from Electron main
  (returns the WSL2 distro's IP visible to Windows).

Open question §8.4: standardize on `wsl.exe hostname -I` vs parsing
`\\wsl$\<Distro>\etc\resolv.conf`. Recommend `wsl.exe hostname -I`
(more direct, fewer parse failure modes).

Spawned-agent shells (WSL-side) never see this complexity; they run
alongside the daemon, so `127.0.0.1` works in both modes. The
spawn-pipeline injects `$VOICETREE_DAEMON_URL=http://127.0.0.1:<port>`
into spawned-agent env (§5.3). Windows-discovery logic fires only
inside Electron main.

### 3.3 LAN exposure threat model

`0.0.0.0` bind means anything routing to the host can attempt
connections. The auth token is the gate.

- **Same-LAN port scan.** Mitigated by token — without it, `401`.
- **Token-file leak via second local user.** Mitigated by mode
  `0600`. The project directory is the user's directory; cross-user
  project access is out of scope.
- **Token leak via `ps`.** Mitigated by always reading the token
  from disk. Hook scripts read via `cat`, not via env-arg (§4.4).
- **Token leak via daemon logs.** Mitigated by explicit redaction in
  the access logger — `Authorization` header replaced with
  `Bearer <redacted>` before logging. Acceptance criterion for 9b,
  with a unit test.

TLS deferred (§7 R5). The threat model assumes a trusted LAN
between Windows host and WSL2 distro; on hostile LANs the user is
exposed.

## 4. Wire shapes

Byte-level contracts so 9b, 9c, 9d, and 9e implement against the
same wire.

### 4.1 HTTP transport headers

Every HTTP request (RPC, hook, WS upgrade) MUST include:

```
Authorization: Bearer <hex-token>
Content-Type: application/json    # POST requests only
```

Daemon handler MUST:

- Reject missing/wrong `Authorization` with `401`, empty body. Log
  the request with the header redacted.
- Reject unknown routes with `404`.
- Reject `POST` to a `GET` route (or vice versa) with `405`.
- Reject `/rpc` and `/hook/:source` bodies over 64 KiB with `413`.
- Reject non-UTF-8 or non-JSON bodies with `400` + JSON-RPC
  `parse_error` (`-32700`) when on `/rpc`.

### 4.2 `POST /rpc` — tool dispatch

Request body is one JSON-RPC 2.0 envelope (identical to Step 7 §4.1):

```
{ "jsonrpc": "2.0", "method": "<tool_name>", "params": { … }, "id": <number> }
```

`<tool_name>` is one of the twelve catalog entries (see `step7-design.md`
§4.1 — unchanged). Response is the matching JSON-RPC envelope with
`result` or `error`. HTTP status is `200` for both — JSON-RPC errors
travel in the body, not the status. Non-`200` only for the §4.1
transport errors above.

Connection lifecycle: HTTP keep-alive supported but not required.
Both clients SHOULD use keep-alive within a process lifetime; daemon
treats keep-alive and one-shot identically.

Timeouts: 30s response timeout from client side. Configurable via
`$VOICETREE_DAEMON_TIMEOUT_MS`.

### 4.3 `GET /events` — WebSocket subscription channel

**Handshake.** Standard RFC 6455 WebSocket upgrade. Bearer token in
the `Authorization` header. Server validates BEFORE completing the
WS handshake; on bad token, server returns HTTP `401` and closes the
TCP connection (no WS handshake completion).

**Client → server frames.** Text frames, JSON-encoded:

```
{ "op": "subscribe",   "topics": [ { "topic": "agent-lifecycle", "resumeSeq": 0 }, … ] }
{ "op": "unsubscribe", "topics": ["agent-lifecycle", …] }
```

vt-graphd is the canonical owner of the mounted watcher; this hub
publishes `agent-lifecycle` only (per `docs/daemon-first-architecture.md`).

`resumeSeq` optional; omit (or `0`) for "subscribe from now". If the
server's resume buffer contains the requested `seq`, server replays
from there. Otherwise: a `gap` frame on that topic and the
subscription continues from the current `seq`.

**Server → client frames.** Text frames, JSON-encoded:

```
{ "type": "event", "topic": "<topic>", "seq": <number>, "event": "<event-name>", "data": { … } }
{ "type": "gap",   "topic": "<topic>", "fromSeq": <number>, "currentSeq": <number> }
```

`event` is the per-topic event-kind discriminator; `data` is the
per-event payload; `seq` is monotonic per topic per daemon lifetime.

**Close codes.**

| Code | Reason       | Meaning                                                              |
|------|--------------|----------------------------------------------------------------------|
| 1000 | "normal"     | Server shutting down.                                                |
| 1008 | "policy"     | Auth token rotated mid-stream (daemon restart).                      |
| 1009 | "too big"    | Inbound client frame exceeds 256 KiB (defense-in-depth — see §8.6). |
| 1011 | "overflow"   | Subscriber's outbound buffer overflowed.                             |

Client handles all close codes uniformly: reconnect via §2.9
backoff.

**Topic taxonomy (initial, 9b ships).**

| Topic              | Event names                                                       | Data shape                                                              |
|--------------------|-------------------------------------------------------------------|-------------------------------------------------------------------------|
| `agent-lifecycle`  | `agent-spawned`, `agent-closed`, `agent-message`, `agent-tool-invoked` | `{ terminalId: string, source: "claude"|"codex"|"opencode", at: <epoch-ms>, … }` |

Adding topics later is server-side only; non-subscribers unaffected.

### 4.4 `POST /hook/:source` — agent lifecycle ingestion

Inherits Step 7e's contract unchanged. JSON body validated by the
existing zod schema; 64 KiB body cap; `204 No Content` on success;
`400` + JSON error envelope on bad body. `:source` is one of
`claude`, `codex`, `opencode`.

Auth: bearer token via §4.1. Hook scripts in spawned-agent shells
read the token from `<project>/.voicetree/auth-token` via `cat`, NOT
from `$VOICETREE_AUTH_TOKEN` as a command-line argument (avoids
`ps` leak — §3.3). The hook curl template:

```bash
TOKEN=$(cat "$VOICETREE_PROJECT_PATH/.voicetree/auth-token")
curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  --data-binary @- \
  "$VOICETREE_DAEMON_URL/hook/$SOURCE?terminal=$TERMINAL_ID&event=$EVENT"
```

After hook ingestion, the daemon publishes a corresponding
`agent-lifecycle` event on `/events` so subscribers see it in real
time.

### 4.5 `GET /terminals/:id/attach` — tmux WebSocket relay (folded in 9f)

Inherits Step 7f's tmux-relay byte-stream contract unchanged. The
only change in 9f is the listener: instead of a dedicated
Electron-only HTTP+WS server (`tmux-relay-binding.ts`), the route
lives on the single daemon HTTP server.

Auth: bearer token via §4.1 on the upgrade. `:id` learned via
`/rpc list_agents`.

### 4.6 Error codes (on `/rpc`)

Unchanged from Step 7 §4.3 except for one addition (`-32004`):

| Code   | Kind alias              | Meaning                                                                    |
|-------:|-------------------------|----------------------------------------------------------------------------|
| -32700 | `parse_error`           | Malformed JSON.                                                            |
| -32600 | `invalid_request`       | Not a valid JSON-RPC 2.0 envelope.                                         |
| -32601 | `tool_not_found`        | `method` is not a catalog entry.                                           |
| -32602 | `validation_failed`     | `params` failed zod; `data` carries the schema-violation envelope.         |
| -32603 | `internal_error`        | Unexpected exception.                                                      |
| -32000 | `daemon_unreachable`    | CLI-side synthetic — no daemon at the expected URL. Not emitted by daemon. |
| -32001 | `renderer_required`     | Live tool against a headless daemon.                                       |
| -32002 | `caller_terminal_unknown` | Write tool with no valid `callerTerminalId`.                              |
| -32003 | `tool_handler_failed`   | Catalog handler returned a domain-level failure.                           |
| -32004 | `auth_required` (NEW)   | CLI-layer translation of HTTP `401` for callers expecting structured errors. |

The CLI-layer error envelopes (`schema_violation`,
`graph_create_batch_result`) ride through `data` unchanged from
Step 7 §4.4. Implementers MUST verify round-trip when swapping wires.

## 5. File inventory

LOC counts carry the 3× pad (§1). STOP-and-surface if blown even
after padding.

Assumes Step 7g (`@vt/vt-daemon` → `@vt/tool-catalog`, commit
`fab76e7d`) is on origin; paths below use the renamed package.

### 5.1 Files deleted

| File                                                                            | LOC   | Removed in |
|---------------------------------------------------------------------------------|------:|------------|
| `packages/systems/tool-catalog/src/transport/udsServer.ts`                      | ~288  | 9b         |
| `packages/systems/tool-catalog/src/hooks/hookHttpServer.ts`                     | ~154  | 9b         |
| `packages/systems/tool-catalog/src/hooks/hookPortFile.ts`                       | ~26   | 9b         |
| `packages/systems/tool-catalog/src/transport/socketPath.ts`                     | ~19   | 9b         |
| `webapp/.../runtime/electron/app/uds-server-binding.ts`                         | ~62   | 9b         |
| `webapp/.../runtime/electron/app/hook-server-binding.ts`                        | ~37   | 9b         |
| `webapp/.../runtime/electron/app/tmux-relay-binding.ts`                         | ~83   | 9f         |
| `webapp/.../cli/daemon-client.ts` (UDS-specific half)                           | ~180  | 9c (rewrite) |
| `packages/libraries/graph-tools/src/live/liveTransport.ts` (UDS-specific half)  | ~180  | 9d (rewrite) |
| `packages/systems/tool-catalog/src/headless/headlessServer.ts` (UDS-specific half) | ~220 | 9b (rewrite) |

### 5.2 Files created

| File                                                                            | LOC target | Created in |
|---------------------------------------------------------------------------------|-----------:|------------|
| `packages/systems/tool-catalog/src/transport/httpServer.ts`                     | ~280       | 9b         |
| `packages/systems/tool-catalog/src/transport/authToken.ts`                      | ~60        | 9b         |
| `packages/systems/tool-catalog/src/transport/eventSubscriptionHub.ts`           | ~200       | 9b         |
| `packages/systems/tool-catalog/src/transport/portFile.ts`                       | ~40        | 9b         |
| `webapp/.../cli/daemon-client.ts` (rewritten — HTTP)                            | ~180       | 9c         |
| `packages/libraries/graph-tools/src/live/liveTransport.ts` (rewritten — HTTP)   | ~180       | 9d         |
| `packages/systems/tool-catalog/src/headless/headlessServer.ts` (rewritten)      | ~220       | 9b         |
| `webapp/.../renderer/live/eventSubscription.ts`                                 | ~200       | 9e         |
| `webapp/.../runtime/electron/app/http-server-binding.ts`                        | ~90        | 9b         |

### 5.3 Files modified (non-trivially)

| File                                                                            | Change                                                                                                                                                  | Modified in |
|---------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|-------------|
| `webapp/.../cli/voicetree-cli.ts`                                               | Replace UDS path discovery with URL discovery; honor `$VOICETREE_DAEMON_URL` first.                                                                     | 9c          |
| `packages/systems/tool-catalog/bin/vt-mcpd.ts`                                  | Replace UDS + hook-port binds with single HTTP bind; write `rpc.port` + `auth-token` atomically; redacted access log.                                   | 9b          |
| `webapp/.../runtime/electron/app/main.ts`                                       | Replace UDS/hook/tmux-relay startup with single HTTP bind; surface `mainAPI.getDaemonUrl()` / `getAuthToken()` (replaces `getTmuxRelayPort`).            | 9b          |
| `webapp/.../cli/commands/runtime/serve.ts`                                      | Same swap on the headless code path.                                                                                                                    | 9b          |
| `packages/systems/agent-runtime/.../buildTerminalEnvVars.ts`                    | Inject `$VOICETREE_DAEMON_URL` + `$VOICETREE_PROJECT_PATH` into spawned-agent env. DO NOT pass the token via env — hook script reads from file (§4.4).    | 9b          |
| `packages/systems/agent-runtime/.../agentHookInjection.ts`                      | Update hook curl template per §4.4 — token via `cat`, URL via `$VOICETREE_DAEMON_URL`.                                                                  | 9b          |

### 5.4 Renderer state path

vt-graphd is the canonical owner of the mounted watcher; this hub
publishes `agent-lifecycle` only (per
`docs/daemon-first-architecture.md`). The renderer opens a WebSocket
to `/events` and subscribes to `agent-lifecycle`; chokidar-derived
file events are no longer fanned out via this channel.

Open question §8.1: where the renderer-side WebSocket client lives
(directly in renderer vs in Electron main with re-broadcast).

## 6. Substep dependency graph

```
                     ┌─────► 9b (HTTP server + auth + subscription hub) ──┐
                     │                                                    │
   9a (this doc) ────┼─────► 9c (CLI HTTP client) ────────────────────────┤
                     │                                                    ├──► 9f (tmux relay fold) ──► 9g (cleanup)
                     ├─────► 9d (graph-tools HTTP client) ────────────────┤
                     │                                                    │
                     └─────► 9e (renderer subscription, stub server) ─────┘
```

- `9a → {9b, 9c, 9d, 9e}` — 9b through 9e may start in parallel.
  9e can develop against a stub server built from the §4.3
  envelopes before 9b is on origin.
- `{9b, 9c, 9d} → 9f` — 9f folds tmux relay; needs the single HTTP
  server (9b) plus migrated clients (9c, 9d) — otherwise the fold
  strands UDS consumers.
- `{9b, 9c, 9d, 9e, 9f} → 9g` — final sweep: orphan typecheck,
  package-boundaries re-validation, residual `uds`/`socket` audit,
  doc updates.

**No dual-wire window.** 9b deletes UDS server files in the same
commit it adds the HTTP server. 9c lands atomically with 9b (the
orchestrator sequences them so `dev-lochlan` is never stuck without
a CLI↔daemon path).

## 7. Residual risks

### R1 — WSL2 networking compat across Windows versions

Mirrored vs NAT mode; version detection is fragile. Mitigated by
`0.0.0.0` + auth token covering both modes (§3.2).

### R2 — WebSocket subscription channel is novel

Tmux relay is byte-stream WS, not pubsub. The hub
(`eventSubscriptionHub.ts`) has no precedent in this repo and is
likely to overrun estimates per the synthesis 3–5× pattern.
Mitigated by pinning the envelope tightly in §4.3 and testing the
hub in isolation before chokidar integration.

### R3 — Renderer state path changes shape

In-process IPC → cross-bridge WebSocket. RTT sub-5ms on the WSL hop
is plausible but unmeasured. Disconnect UX must be graceful.
Mitigated by bounded resume buffer (§2.6); 9e's brief must specify
the graceful-disconnect UX.

### R4 — Spawned-agent hook curl URL

Hook scripts need `$VOICETREE_DAEMON_URL`, not literal `127.0.0.1:port`.
Step 7's `$VOICETREE_HOOK_PORT` template assumed loopback.
Mitigated by §5.3 spawn-pipeline injection of
`$VOICETREE_DAEMON_URL=http://127.0.0.1:<port>` for spawned agents
(which always run inside WSL alongside the daemon).

### R5 — Auth token leak via `ps`

Token NEVER passed on command line. Read from disk by every
consumer; daemon access log redacts the `Authorization` header.
Implementers MUST add a redaction unit test for `httpServer.ts`.

TLS is deferred — the threat model assumes a trusted LAN segment
between Windows host and WSL2 distro. On a hostile LAN the user is
exposed.

### R6 — Test-environment port collisions

Bind port 0, read back via `server.address()`, publish to the
test-specific project path. Auth tokens generated fresh per test
daemon. Mirrors Step 7e's port-0 pattern.

### R7 — Cycle-forced duplication carries over

Synthesis §4.1 flagged that `graph-tools` cannot import from
`@vt/tool-catalog` at runtime (reverse dependency exists). Without
an explicit plan, HTTP client framing + token reader + reconnect
helper will live in two places.

Mitigation options:

- **(a) Extract `packages/libraries/vt-rpc/`** — a thin library
  containing the HTTP client primitives. Both `tool-catalog`
  consumers and `graph-tools` depend on it. Recommended.
- **(b) Accept duplication for 9b/9c/9d, surface as 9g cleanup.**

Surfaced as open question §8.3. Orchestrator (Gus) decides before
9c/9d start.

### R8 — Design-doc miss class (synthesis lesson)

Step 7's 631-line ADR missed the tmux relay dependency mid-flight.
Even a thorough design doc misses real dependencies in a 6-month-old
codebase.

Mitigation: before each substep starts, the orchestrator runs a
`grep` audit for the surfaces being changed:

- 9b: `udsServer|hookHttpServer|socketPath|net\.createServer|http\.createServer`
- 9c: `VOICETREE_SOCK_PATH|vt\.sock|daemon-client`
- 9d: `liveTransport|udsLiveTransport|VOICETREE_SOCK`
- 9e: `getTmuxRelayPort|mainAPI\.`
- 9f: `tmux-relay-binding|terminals/.*attach|tmuxAttachRelay`

Audit results land in the implementer's spawn context. Surfaces
discovered mid-flight that the audit missed are STOP-and-surface
events.

## 8. Open questions surfaced during 9a drafting

The brief said to surface, not resolve. Each below is something this
doc does not pin.

### 8.1 Renderer WebSocket client: renderer or main?

Two options:

- **(a) In the renderer directly.** Renderer holds the auth token
  (which it already needs for `/rpc`), opens the WS, handles
  reconnects.
- **(b) In Electron main, re-broadcast via preload bridge.**

Recommendation: (a). Adding a bridge layer buys nothing when the
renderer already needs the token. Pin in 9e's brief.

### 8.2 Topic taxonomy completeness

§4.3 initial taxonomy lists `agent-lifecycle` only — vt-graphd is the
canonical owner of the mounted watcher; this hub publishes
`agent-lifecycle` only (per `docs/daemon-first-architecture.md`).
Candidates worth checking via R8 grep audit before 9e lands:

- `terminal-output` — likely no (tmux relay is its own WS).
- `graph-mutations` — likely no (filesystem watches subsume).
- `agent-progress` — maybe. Today progress nodes land via
  filesystem writes; if the renderer needs structured agent-progress
  separate from filesystem watches, 9b should ship the topic.

### 8.3 `vt-rpc` extraction (R7)

Decision needed before 9c/9d start. Recommend extracting
`packages/libraries/vt-rpc/` in 9b. Orchestrator call.

### 8.4 Windows-side daemon URL discovery method (§3.2)

`wsl.exe hostname -I` vs parsing `\\wsl$\<Distro>\etc\resolv.conf`.
Recommend the former. Pin in 9e's brief.

### 8.5 `vt-mcpd` rename?

Step 7g left the binary name alone. "mcp" is doubly stale post-9.
Cosmetic, not blocking. Defer to 9g or post-9g.

### 8.6 WebSocket inbound max frame size

§4.3 closes with `1009 too big` on overflow. Recommended cap:
256 KiB per inbound frame. Current chokidar payloads are sub-1 KiB
so this is defense-in-depth. Implementers pin in 9b.

### 8.7 Stale port-file / token-file cleanup

HTTP has no UDS-style stale-socket pathology (no socket to unlink).
Daemon bootstrap overwrites `rpc.port` and `auth-token` atomically
on every restart. Clients that read the port file and find no
listener surface `daemon_unreachable`.

## 9. Acceptance criteria (for 9a)

This document satisfies the brief if:

- All ten ratified decisions are in §2 with decision + rationale +
  rejected alternatives.
- Wire envelopes for `/rpc`, `/hook/:source`, `/events`, and
  `/terminals/:id/attach` are pinned at byte-level (§4) so 9b and
  9e implement against the same contract.
- File inventory (§5) tells 9b/9c/9d/9e which files they own.
- WSL networking (§3) covers both mirrored and NAT modes.
- Auth-token threat model (§3.3, §7 R5) is documented.
- Open questions (§8) are explicit. The brief said surface, not
  resolve.

---

End of design. Implementers (9b–9g): if you find yourself making a
decision this document does not answer, surface it as a new open
question rather than baking your call into a commit. The synthesis
lesson: even a careful design doc misses real dependencies; the
grep-audit pass (§7 R8) is your first defense against that.

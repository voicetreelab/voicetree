# BF-376 outbound — design lock (Stage 1 / S1)

This is the contract the rest of BF-376 builds against. It freezes:

1. The 19 RPC routes Main → VTD speaks, with typed request/response shapes.
2. The 11 surface methods that get **no** RPC (each replaced by something already in place).
3. The 5 events on the new `terminal-registry` SSE topic (sources cited).
4. The disposition of two things the old surface used to do — telemetry sinks and `getRuntimeUI().*` callbacks.
5. The spawn-family collapse decision (kept at 3 separate routes — shapes diverge).

Source of truth nodes:

- `bf376-rpc-route-justification.md` — per-route triage of the 33-method `terminalRuntimeSurface`
- `bf376-terminal-registry-events.md` — five event shapes and source publishers
- `bf376-vt-daemon-protocol-package.md` — protocol package layout and closure invariant
- `bf376-outbound-orchestration-plan.md` — stage map

Wire dialect: JSON-RPC 2.0 over POST `/rpc` on the daemon's existing HTTP pipeline (`packages/systems/vt-daemon/src/transport/rpcDispatch.ts`). The contract package is `@vt/vt-daemon-protocol`, sibling to `@vt/graph-db-protocol`. fp-ts `Option<X>` and branded strings (`TerminalId`) round-trip cleanly through JSON (`{_tag:'None'} | {_tag:'Some',value}` for Option; nominal strings for brands).

---

## 1. The 19 RPC routes

Request / response shapes live in `packages/libraries/vt-daemon-protocol/src/rpc-contracts.ts` under one `namespace` per route. Method names are pinned by `TERMINAL_RPC_METHODS` in that file.

### Spawn family (3)

| Route | Request | Response | Why kept as RPC |
|---|---|---|---|
| `spawnPlainTerminal` | `{nodeId, terminalCount}` | `void` | UI "open a plain shell on this existing node" — needs VTD-side tmux launch. |
| `spawnPlainTerminalWithNode` | `{position, terminalCount}` | `void` | UI "add a node here AND open a shell on it" — atomic node-create + spawn. |
| `spawnTerminalWithContextNode` | `{taskNodeId, agentCommand?, terminalCount?, skipFitAnimation?, startUnpinned?, selectedNodeIds?, spawnDirectory?, parentTerminalId?, promptTemplate?, headless?, inheritTerminalId?, envOverrides?}` | `{terminalId, contextNodeId}` | Agent-spawn workhorse; the only spawn that returns identifiers eagerly (heavy prep is fire-and-forget after RPC returns). |

### Inject / send (2)

| Route | Request | Response | Why kept as RPC |
|---|---|---|---|
| `sendTextToTerminal` | `{terminalId, text}` | `TerminalOperationResult` | Renderer / hook / MCP-side input → tmux send-keys ceremony. |
| `injectNodesIntoTerminal` | `{terminalId, nodeIds}` | `{success, injectedCount}` | Renderer "share these unseen nodes with the agent" gesture. |

### Read state (3)

| Route | Request | Response | Why kept as RPC |
|---|---|---|---|
| `getTerminalRecords` | `{}` | `readonly TerminalRecord[]` | Cold-start snapshot before the SSE subscription delivers deltas. |
| `getUnseenNodesForTerminal` | `{terminalId}` | `readonly UnseenNodeInfo[]` | UI "what would be injected right now?" probe — needs registry + graph join VTD already has. |
| `getExistingAgentNames` | `{}` | `readonly string[]` | Spawn-side collision avoidance (renderer sometimes pre-computes agent names). |

### Tmux unclaimed (3)

| Route | Request | Response | Why kept as RPC |
|---|---|---|---|
| `attachUnclaimedTmuxSession` | `{sessionName}` | `AttachUnclaimedTmuxResult` | Recovery picker action — adopt a live but orphan tmux session into the registry. |
| `listUnclaimedTmuxSessions` | `{}` | `readonly UnclaimedTmuxSession[]` | Recovery picker list — VTD owns the tmux server, so the canonical listing is server-side. |
| `killUnclaimedTmuxSession` | `{sessionName}` | `KillUnclaimedTmuxResult` | Recovery picker "discard". |

### Headless agents (2)

| Route | Request | Response | Why kept as RPC |
|---|---|---|---|
| `closeHeadlessAgent` | `{terminalId}` | `{closed:true,wasRunning} \| {closed:false}` | UI "stop this headless agent" — VTD owns the spawn group + registry row. |
| `getHeadlessAgentOutput` | `{terminalId}` | `string` | UI "show me the captured stdout for the headless agent". |

### Recovery (3)

| Route | Request | Response | Why kept as RPC |
|---|---|---|---|
| `discoverRecoverableAgentSessions` | `{}` | `readonly RecoverableAgentSession[]` | Recovery picker source — reads on-disk metadata, classifies, returns capability flags. |
| `resumePersistedAgentSession` | `{terminalId}` | `ResumePersistedResult` | "Resume that session". Folds `resetAuditRetryCount` into its bookkeeping. |
| `forkAgentSession` | `{sourceTerminalId}` | `ForkAgentSessionResult` | "Fork from that session" — same resume handle, new terminal id. |

### Registry management (2)

| Route | Request | Response | Why kept as RPC |
|---|---|---|---|
| `removeTerminalFromRegistry` | `{terminalId}` | `void` | UI "I closed the panel; drop the row". |
| `patchTerminalRecord` | `{terminalId, patch: TerminalRecordPatch}` | `void` | Polymorphic state mutator. The four prior mutators (pinned / minimized / activity / done) share shape (`(id, value)`) and the same publish side effect; they collapse to one route with a `TerminalRecordPatch` discriminator (kind ∈ `'pinned'|'minimized'|'activity'|'done'`). |

### Hook dispatch (1, Phase-2-only)

| Route | Request | Response | Why kept as RPC |
|---|---|---|---|
| `dispatchOnNewNodeHooks` | `{delta: GraphDelta, hookCommand}` | `void` | Main owns the FS watcher today; the hook fan-out belongs to VTD (it owns the registry + headless spawner). When Phase 3 lands the watcher in VTD this route disappears (route count → 18). Kept named today rather than deferred to a phantom future BF, per the non-deferral mandate. The in-process function also takes a `logHookResult` callback — intentionally not on the wire; VTD wires its own logger at handler registration. |

**Total: 19.** No collapse below this number — see §5 for the spawn-family decision.

---

## 2. The 11 surface methods that get NO RPC

Each was on `terminalRuntimeSurface` today; each is replaced by something already present (the BF-376 design lock; deleting them costs zero, no caller depends on a missing route).

| Method | Why no RPC | What replaces it |
|---|---|---|
| `configureAgentRuntime` | Main never configures the daemon's runtime. | Delete the Main-side call; daemon configures itself at `vtd.ts` boot. |
| `installJsonlTelemetrySink` | Daemon already installs the sink at `vtd.ts:333`; Main's call at `main.ts:269` is the duplicate. | Delete the Main-side call; no replacement (see §3). |
| `getTerminalManager` | Adapter pattern — the design lock kills it. | Direct typed RPC calls via `@vt/vt-daemon-client`. |
| `subscribeToRegistry` | In-process listener pattern. | SSE `terminal-registry` topic + the existing client subscription. |
| `ensureTmuxAvailable` | Daemon self-ensures at startup. | Drop the Main-side call. |
| `ensureTmuxServer` | Daemon self-ensures at startup. | Drop the Main-side call. |
| `reconcileTmuxHeadlessAgents` | Daemon reconciles its own at startup. | Drop the Main-side call. |
| `shutdownTmuxServer` | Daemon owns the tmux lifecycle. | Drop the Main-side call. |
| `updateTerminalAgentEvent` | Once the registry IS the daemon's, hook ingest writes directly. | Internal call inside the daemon's hook handler. |
| `resetAuditRetryCount` | Stop-gate retry counter is part of resume bookkeeping. | Folded into `resumePersistedAgentSession` server-side. |
| `resolveVtBinDir` | Pure FS path resolution; webapp-local helper, not a daemon concern. | Move (or already moved) into a webapp-local helper if any caller still wants it. |

---

## 3. Telemetry-sink verification

```
packages/systems/vt-daemon/bin/vtd.ts:333
  agentRuntime.installJsonlTelemetrySink(join(appSupportPath, 'lifecycle-telemetry.jsonl'))
```

```
webapp/src/shell/edge/main/runtime/electron/app/main.ts:269
  terminalRuntimeSurface.installJsonlTelemetrySink(path.join(appSupportPath, 'lifecycle-telemetry.jsonl'))
```

**Verdict:** delete Main's call at `main.ts:269`. No replacement. The daemon already owns the JSONL sink; Main's call is leftover from when Main hosted the runtime in-process. When Phase 3 retires Main's `agent-runtime` dependency, that block disappears with no observability loss.

---

## 4. `getRuntimeUI()` grep + disposition

`rg "getRuntimeUI\(\)\." packages/systems/agent-runtime/src -n` (executed against worktree `9674a6673`):

| Call site | Method | Disposition |
|---|---|---|
| `application/spawn/launch/spawnPlainTerminal.ts:65` | `launchTerminalOntoUI?(nodeId, terminalData)` | → `terminal-ui-launch` event with `skipFitAnimation: false`. |
| `application/spawn/launch/launchTerminalSpawn.ts:65` | `closeTerminalById?(params.inheritTerminalId)` | Derivable from `terminal-removed` — receiver drops the panel when its registry row disappears. No separate event. |
| `application/spawn/launch/launchTerminalSpawn.ts:67` | `launchTerminalOntoUI?(params.contextNodeId, terminalData, params.skipFitAnimation)` | → `terminal-ui-launch` (with the passed-through `skipFitAnimation`). |
| `application/spawn/launch/launchTerminalSpawn.ts:91` | `registerChildIfMonitored?(params.parentTerminalId, getTerminalId(terminalData))` | → `terminal-ui-child-registered`. |
| `application/spawn/launch/spawnHookTerminal.ts:133` | `launchTerminalOntoUI?(hookNodeId, terminalData, true)` | → `terminal-ui-launch` with `skipFitAnimation: true`. |

After Stage 2-R lands, `getRuntimeUI` and its bridge type can be deleted from `runtime-config.ts`; `RuntimeUIBridge` becomes dead code.

---

## 5. Spawn-family collapse decision

Read the three functions in agent-runtime:

- `spawnPlainTerminal(nodeId: NodeIdAndFilePath, terminalCount: number): Promise<void>` — operates on an existing node, opens a plain shell, no agent command.
- `spawnPlainTerminalWithNode(position: Position, terminalCount: number): Promise<void>` — creates a fresh **orphan** node at a viewport position, then calls `spawnPlainTerminal` on it.
- `spawnTerminalWithContextNode(taskNodeId, agentCommand?, terminalCount?, skipFitAnimation?, startUnpinned?, selectedNodeIds?, spawnDirectory?, parentTerminalId?, promptTemplate?, headless?, inheritTerminalId?, envOverrides?, deps?): Promise<{terminalId, contextNodeId}>` — runs an **agent** command, reuses or creates a context node, returns identifiers eagerly while the heavy launch runs in the background.

The three signatures differ on more than just argument-set size:

1. **Input shape** — `NodeIdAndFilePath` vs `Position` vs `NodeIdAndFilePath + agentCommand + …`. There is no common discriminated input; the entry points are doing genuinely different things (open shell on existing node vs create node + shell vs spawn agent with context).
2. **Return shape** — two return `void`, the third returns `{terminalId, contextNodeId}`. The third's caller depends on those identifiers; collapsing would either widen the void variants to return identifiers they cannot meaningfully produce, or force the agent variant to suppress its return value.
3. **Semantic side effects** — only the third variant runs an agent command, eagerly reserves a `pendingTerminal` row, and resolves context-node selection-vs-subgraph branching.

**Decision: keep all three as separate routes.** Forcing a polymorphic `spawnTerminal(variant, params)` would be cosmetic — it would hide three distinct operations behind a single dispatch shape while removing zero handler code (the server would still branch on `variant` and call exactly the same three functions). CLAUDE.md: deep and narrow. Share shape → one route; share name only → separate routes.

**Final route count: 19.** Drops to 18 if/when Phase 3 lands the FS watcher in VTD and `dispatchOnNewNodeHooks` retires.

---

## 6. The `terminal-registry` SSE topic

New topic on Leaf B's hub. `transport/eventSubscriptionHub.ts` ships `ALLOWED_TOPICS = ['vault-state', 'agent-events']` today; Stage 2-S adds `'terminal-registry'`. No change to the `agent-events` envelope.

| Event | Payload (TS, from `vt-daemon-protocol/src/terminal-registry-events.ts`) | Source publishing point inside agent-runtime |
|---|---|---|
| `terminal-registered` | `{record: TerminalRecord}` | `recordTerminalSpawn` — `application/terminals/terminal-registry/spawn.ts:14` |
| `terminal-removed` | `{terminalId: TerminalId}` | `removeTerminalFromRegistry` — `application/terminals/terminal-registry/queries.ts:20` |
| `terminal-record-changed` | `{terminalId, patch: TerminalRecordPatch}` | `updateTerminal{Pinned,Minimized,ActivityState,IsDone}` (`updates.ts` / `lifecycle.ts`) — after S2-R rewires them to publish via the `patchTerminalRecord` server handler |
| `terminal-ui-launch` | `{nodeId, terminalData, skipFitAnimation}` | replaces `getRuntimeUI().launchTerminalOntoUI` in `spawnPlainTerminal`, `launchTerminalSpawn`, `spawnHookTerminal` |
| `terminal-ui-child-registered` | `{parentTerminalId, childTerminalId}` | replaces `getRuntimeUI().registerChildIfMonitored` in `launchTerminalSpawn` |

Receivers exhaustively switch on `type` (see `TerminalRegistryEvent` union). Vault-switch fence applies identically — envelopes whose `vault` does not match `getActiveVault()` are dropped at the Main-side bridge before reaching the renderer.

---

## 7. What the protocol package owns now

`packages/libraries/vt-daemon-protocol/` — added in Stage 1 commits:

```
package.json
tsconfig.json
src/
  index.ts                    # barrel
  terminal-types.ts           # TerminalRecord, TerminalData, TerminalId, TerminalSpawnResult, TerminalRecordPatch, TerminalLifecycle, TerminalKillReason, AgentEventKind, TerminalStatus, CreateTerminalDataParams
  rpc-contracts.ts            # 19 routes × {Request, Response}, plus RecoverableAgentSession / ResumePersistedResult / ForkAgentSessionResult / UnclaimedTmuxSession / AttachUnclaimedTmuxResult / KillUnclaimedTmuxResult / UnseenNodeInfo / TERMINAL_RPC_METHODS
  terminal-registry-events.ts # 5 event payloads + TERMINAL_REGISTRY_TOPIC + TERMINAL_REGISTRY_EVENT_TYPES
```

Import policy enforced (closure invariant from `bf376-vt-daemon-protocol-package.md`):

| Package | Imports from `@vt/vt-daemon-protocol` | Imports from `@vt/agent-runtime` |
|---|---|---|
| `@vt/vt-daemon-protocol` | (self) | **NO** (protocol upstream of runtime) |
| `@vt/agent-runtime` | YES (re-exports protocol shapes for back-compat) | (self) |
| `@vt/vt-daemon` (server) | YES | YES (daemon launchers may; boundary-test allowance) |
| `@vt/vt-daemon-client` (Stage 2-C) | YES | **NO** |
| `webapp/src` (Stage 3 closure) | NO (via client) | **NO** |

The closure check at Stage 4 will verify `rg "@vt/agent-runtime" webapp/src` returns zero.

---

## 8. Out-of-Stage-1 (handed off to later stages)

Stage 1 is contracts-only. The following are intentionally NOT done in this leaf:

- **Stage 2-R** rewires the publishing points: registry mutations call into a publish helper that emits onto the new topic; `getRuntimeUI` callbacks are deleted and replaced with publishes; the `RuntimeUIBridge` type retires.
- **Stage 2-S** adds the 19 handlers to VTD's catalog, wires `transport/eventSubscriptionHub.ts` to accept `'terminal-registry'`, and publishes the events when agent-runtime mutates state.
- **Stage 2-C** adds `@vt/vt-daemon-client` typed wrappers (one per route) and extends Leaf B's `agent-events-sse-subscription` to subscribe to `terminal-registry`.
- **Stage 3** rewrites the 13 Main caller files, deletes `terminalRuntimeSurface`, deletes the 11 surface methods named in §2, and drops `@vt/agent-runtime` from `webapp/package.json`.
- **Stage 4** runs the closure verifier (grep, boundary lint, e2e suite via `flock`).

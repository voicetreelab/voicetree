/**
 * Public surface of `@vt/vt-daemon-client`.
 *
 * Three layers:
 *
 *  1. **Launcher** — `ensureVtDaemonForVault` is the only sanctioned way to
 *     obtain a `VtDaemonClient` for a vault (BF-373 owner-aware single-flight).
 *
 *  2. **Transport** — `VtDaemonClient` exposes `.health()` and
 *     `.rpc<T>(method, params)` over the bound HTTP + bearer.
 *
 *  3. **Typed BF-376 facade** — `bindVtDaemonClient(client)` returns the
 *     four per-domain facades (`terminals`, `recovery`, `tmuxUnclaimed`,
 *     `hooks`) covering the 19 RPC routes in design.md §1. Free per-route
 *     wrappers are also re-exported for callers that already hold the
 *     client directly (tests, advanced consumers).
 *
 *  4. **Protocol re-exports** — every shape the wire contract owns
 *     (`TerminalRecord`, `TerminalSpawnResult`, `TerminalRecordPatch`,
 *     `TerminalId`, `TerminalData`, plus the 19-route Request/Response
 *     namespaces and the `terminal-registry` SSE event payloads). The
 *     "closure invariant" path (`bf376-vt-daemon-protocol-package.md`):
 *     webapp imports terminal types from here without ever taking a
 *     runtime dependency on `@vt/agent-runtime`.
 *
 * Anti-pattern explicitly forbidden by design.md §7: re-exporting any
 * symbol from `@vt/agent-runtime` through this barrel. The closure check
 * at Stage 4 will grep for it across `webapp/src`.
 */

export {
  ensureVtDaemonForVault,
  type EnsureVtDaemonOptions,
  type EnsureVtDaemonResult,
} from './autoLaunch/ensureVtDaemon.ts'

export {
  VtDaemonClient,
  type VtDaemonClientOptions,
  type VtDaemonRpcResponse,
} from './VtDaemonClient.ts'

export {
  bindVtDaemonClient,
  type VtDaemonClientFacade,
  type HooksFacade,
  type RecoveryFacade,
  type TerminalsFacade,
  type TmuxUnclaimedFacade,
  // Free wrappers — one per RPC route, taking a `VtDaemonClient` as the
  // first argument. The facade closes over the client; these are for
  // direct callers and tests.
  closeHeadlessAgent,
  discoverRecoverableAgentSessions,
  dispatchOnNewNodeHooks,
  forkAgentSession,
  getExistingAgentNames,
  getHeadlessAgentOutput,
  getTerminalRecords,
  getUnseenNodesForTerminal,
  injectNodesIntoTerminal,
  patchTerminalRecord,
  removeTerminalFromRegistry,
  resumePersistedAgentSession,
  sendTextToTerminal,
  spawnPlainTerminal,
  spawnPlainTerminalWithNode,
  spawnTerminalWithContextNode,
  attachUnclaimedTmuxSession,
  killUnclaimedTmuxSession,
  listUnclaimedTmuxSessions,
} from './wrappers/index.ts'

// Protocol re-exports — `@vt/vt-daemon-protocol` is the canonical home;
// the client re-exports its full surface so webapp callers do not need
// a separate dependency on the protocol package. Stage 4 closure check
// asserts no `@vt/agent-runtime` symbol leaks through this re-export.
export * from '@vt/vt-daemon-protocol'

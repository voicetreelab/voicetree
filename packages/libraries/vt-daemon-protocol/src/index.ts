// Public barrel for @vt/vt-daemon-protocol.
//
// Both the daemon (`@vt/vt-daemon`) and its typed client
// (`@vt/vt-daemon-client`) import shapes through this file. Webapp gets the
// terminal types via the client re-exporting from here — what is forbidden
// is laundering a `@vt/agent-runtime` runtime dependency through the
// client (see `bf376-vt-daemon-protocol-package.md` closure invariant).
//
// Per-domain modules populate this barrel as BF-376 / S1 lands:
//   - `terminal-types.ts`            — TerminalRecord, TerminalSpawnResult, TerminalData, TerminalId, TerminalRecordPatch
//   - `rpc-contracts.ts`             — request/response shapes for the 19 RPC routes
//   - `terminal-registry-events.ts`  — payload shapes for the `terminal-registry` SSE topic

export * from './core-types.ts'
export * from './terminal-types.ts'
export * from './rpc-contracts.ts'
export * from './terminal-registry-events.ts'
export * from './from-prefix-message.ts'
export * from './tool-spec-types.ts'
// Of the 15 exports in tool-specs.ts, only `TOOL_SPECS` belongs on the
// public surface. Sibling packages iterate that array; the per-tool
// `*_SPEC` constants are implementation detail used to compose the
// array and re-exporting each one duplicates coupling on every
// consumer that only ever needs the whole catalog.
export {TOOL_SPECS} from './tool-specs.ts'
// CLI-local doc-only specs (verbs documented in the manual that do NOT
// dispatch to a daemon RPC) and the combined `MANUAL_SPECS` the manual
// renders. Daemon dispatch still binds `TOOL_SPECS` alone.
export {CLI_LOCAL_SPECS} from './cli-local/index.ts'
export {MANUAL_SPECS} from './manual-specs.ts'
export * from './renderManual.ts'

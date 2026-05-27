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

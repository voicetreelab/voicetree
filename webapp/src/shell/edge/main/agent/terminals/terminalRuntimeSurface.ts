/**
 * Re-export of vt-daemon's terminalRuntimeSurface for webapp-Main use.
 *
 * STATUS (post-BF-376 / half-cutover, see voicetree-26-5/phase-2-leaf-b-COORDINATION.md):
 *
 * Inbound side  (hook events → renderer terminal badges):
 *   FIXED. Hook events flow from VTD's `/hook/:source` → its hub publish
 *   on `agent-events` → Main's SSE subscriber
 *   (`runtime/electron/daemon/sync/agent-events-sse-subscription.ts`) →
 *   `agent-events-registry-bridge.ts` → in-process
 *   `agentRuntime.updateTerminalAgentEvent` → registry subscribers →
 *   renderer. The vault-switch fence drops envelopes whose `vault` does
 *   not match `getActiveVault()` (main-host-purity §"Vault-switch fence").
 *
 * Outbound side (Main → agent-runtime mutations):
 *   NOT YET CUT OVER. `terminalRuntimeSurface.spawnPlainTerminal`,
 *   `sendTextToTerminal`, etc. continue to dispatch into the in-process
 *   `@vt/agent-runtime` instance configured by `main.ts:129` →
 *   `configureAgentRuntime`. The BF-376 spec proposes routing these
 *   through the per-vault VTD's RPC surface; that requires ~40 new RPC
 *   tools on vt-daemon and ~30 caller refactors from sync to async —
 *   tracked as BF-376b. Until then, agent-runtime state is split-brain:
 *   Main's spawn lives in Main's registry; a VTD-side CLI peer's spawn
 *   lives only in VTD's registry. The renderer therefore only sees
 *   Main-spawned agents (matching pre-Phase-2 behaviour).
 *
 * Boundary lint:
 *   The reach into `@vt/vt-daemon/tools/agent-control/terminalRuntimeSurface`
 *   is the only legitimate `@vt/vt-daemon[^-]` consumer of agent-control
 *   shapes in webapp/. It will go away when BF-376b completes the
 *   outbound cutover — at which point this file becomes the deep function
 *   described in BF-376's "Deep function plan" (SSE subscriber + RPC
 *   fan-out, no @vt/vt-daemon import).
 */
export {
    terminalRuntimeSurface,
    type AgentRuntimeConfig,
    type TerminalManager,
    type TerminalRecord,
    type TerminalSpawnResult,
} from '@vt/vt-daemon/tools/agent-control/terminalRuntimeSurface'

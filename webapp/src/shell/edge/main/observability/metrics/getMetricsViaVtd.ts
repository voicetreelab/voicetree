// BF-382 · Phase 3 — Main-side metrics surface, sourced from VTD.
//
// Replaces the deleted `agent-metrics-store.ts` Main-side reader. Both
// Electron Main (via this wrapper) and any CLI peer reach the same JSON-RPC
// surface (`metrics.getSessions`) against the same `<vault>/.voicetree/
// agent_metrics.json` file owned by the daemon. The renderer's
// `useAgentMetrics` hook calls `window.electronAPI.main.getMetrics()`; the
// shape of `AgentMetricsData` is preserved end-to-end.

import {createRpcClientForVault, type DaemonRpcClient, type JsonRpcResponse} from '@vt/vt-rpc'
import type {AgentMetricsData, SessionMetric} from '@vt/vt-daemon'

import {getActiveVault} from '@/shell/edge/main/runtime/electron/daemon/daemon-url-binding'

// Cache one RPC client per vault. The renderer's useAgentMetrics hook polls
// every ~10s; rebuilding the client per call re-reads rpc.port + auth-token
// from disk each time. Keyed on absolute vault path; entries for prior vaults
// linger after vault rebind (negligible — one daemon-client struct per vault
// ever opened in a session).
const clientByVault: Map<string, DaemonRpcClient> = new Map()

async function getClient(vault: string): Promise<DaemonRpcClient> {
    const cached: DaemonRpcClient | undefined = clientByVault.get(vault)
    if (cached) return cached
    const client: DaemonRpcClient = await createRpcClientForVault(vault, {env: process.env})
    clientByVault.set(vault, client)
    return client
}

export async function getMetrics(): Promise<AgentMetricsData> {
    // Read the webapp's authoritative active-vault snapshot — `daemon-url-
    // binding` is the module that owns "the vault Main currently considers
    // active" (set by `bindVtDaemonForVault`). Previously this read
    // `peekCurrentVault()` from `@vt/vt-daemon`, but that exposes a
    // module-level cell mutated only by the vt-daemon BINARY's process;
    // webapp's in-process copy is never written, so the function always
    // returned null and the whole metrics flow silently degraded to
    // `{sessions: []}`.
    const vault: string | null = getActiveVault()
    if (vault === null) {
        // No vault bound yet (boot races, vault rebind in progress). Mirrors
        // the legacy Main-side behaviour on a missing file: return an empty
        // surface rather than throwing — the renderer treats the hook as
        // "no sessions yet."
        return {sessions: []}
    }
    const client: DaemonRpcClient = await getClient(vault)
    const response: JsonRpcResponse = await client.call('metrics.getSessions', {})
    if ('error' in response) {
        throw new Error(`metrics.getSessions: ${response.error.message}`)
    }
    const result: {readonly sessions: readonly SessionMetric[]} = response.result as {
        readonly sessions: readonly SessionMetric[]
    }
    return {sessions: result.sessions}
}

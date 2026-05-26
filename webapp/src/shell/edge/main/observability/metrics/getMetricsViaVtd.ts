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

import {peekCurrentVault} from '@vt/vt-daemon'

export async function getMetrics(): Promise<AgentMetricsData> {
    const vault: string | null = peekCurrentVault()
    if (vault === null) {
        // No vault bound yet (boot races, vault rebind in progress). Mirrors
        // the legacy Main-side behaviour on a missing file: return an empty
        // surface rather than throwing — the renderer treats the hook as
        // "no sessions yet."
        return {sessions: []}
    }
    const client: DaemonRpcClient = await createRpcClientForVault(vault, {env: process.env})
    const response: JsonRpcResponse = await client.call('metrics.getSessions', {})
    if ('error' in response) {
        throw new Error(`metrics.getSessions: ${response.error.message}`)
    }
    const result: {readonly sessions: readonly SessionMetric[]} = response.result as {
        readonly sessions: readonly SessionMetric[]
    }
    return {sessions: result.sessions}
}

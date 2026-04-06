/**
 * In-memory index of nodes created by each agent via create_graph.
 * Populated at create_graph call time — eliminates the race condition where
 * the file watcher hasn't ingested nodes before the agent exits.
 *
 * Keyed by terminalId. Values accumulate across multiple create_graph calls
 * from the same terminal only, which prevents stale nodes from earlier agents
 * with the same display name from satisfying the progress-node gate.
 */

export interface AgentNodeEntry {
    readonly nodeId: string
    readonly title: string
}

const agentNodes: Map<string, AgentNodeEntry[]> = new Map()

export function registerAgentNodes(terminalId: string, nodes: readonly AgentNodeEntry[]): void {
    const existing: AgentNodeEntry[] = agentNodes.get(terminalId) ?? []
    agentNodes.set(terminalId, [...existing, ...nodes])
}

export function getAgentNodes(terminalId: string): readonly AgentNodeEntry[] {
    return agentNodes.get(terminalId) ?? []
}

export function clearAgentNodes(): void {
    agentNodes.clear()
}

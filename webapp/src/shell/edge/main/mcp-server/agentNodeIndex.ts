/**
 * In-memory index of nodes created by each agent via create_graph.
 * Populated at create_graph call time — eliminates the race condition where
 * the file watcher hasn't ingested nodes before the agent exits.
 *
 * Keyed by agentName. Values accumulate across multiple create_graph calls.
 */

export interface AgentNodeEntry {
    readonly nodeId: string
    readonly title: string
}

const agentNodes: Map<string, AgentNodeEntry[]> = new Map()

export function registerAgentNodes(agentName: string, nodes: readonly AgentNodeEntry[]): void {
    const existing: AgentNodeEntry[] = agentNodes.get(agentName) ?? []
    agentNodes.set(agentName, [...existing, ...nodes])
}

export function getAgentNodes(agentName: string): readonly AgentNodeEntry[] {
    return agentNodes.get(agentName) ?? []
}

export function clearAgentNodes(): void {
    agentNodes.clear()
}

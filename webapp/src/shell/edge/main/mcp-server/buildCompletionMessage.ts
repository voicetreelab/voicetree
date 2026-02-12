/**
 * Pure function: formats agent completion results into a notification message.
 * Used by the async agent monitor to notify parent agents when all children complete.
 */

export interface AgentResult {
    terminalId: string
    agentName: string | undefined
    status: 'running' | 'idle' | 'exited'
    nodes: Array<{nodeId: string; title: string}>
}

export function buildCompletionMessage(agentResults: AgentResult[]): string {
    const lines: string[] = ['[WaitForAgents] All agents completed.']

    for (const agent of agentResults) {
        const name: string = agent.agentName ?? agent.terminalId
        const nodeList: string =
            agent.nodes.length > 0
                ? agent.nodes.map((n: {nodeId: string; title: string}) => n.title).join(', ')
                : '(no nodes created)'
        lines.push(`- ${name} [${agent.status}]: ${nodeList}`)
    }

    return lines.join('\n')
}

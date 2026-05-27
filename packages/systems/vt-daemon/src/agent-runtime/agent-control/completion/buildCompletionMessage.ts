/**
 * Pure function: formats agent completion results into a notification message.
 * Used by the async agent monitor to notify parent agents when all children complete.
 */

export interface AgentResult {
    terminalId: string
    agentName: string | undefined
    status: 'running' | 'idle' | 'exited'
    exitCode: number | null
    nodes: Array<{nodeId: string; title: string}>
    /** Truncated last output from headless agent — included when exitCode !== 0 for diagnostics. */
    lastOutput?: string
}

export function buildCompletionMessage(agentResults: AgentResult[], stillWaitingOn?: readonly string[]): string {
    const parts: string[] = ['[WaitForAgents] Agent(s) completed.']

    for (const agent of agentResults) {
        const name: string = agent.agentName ?? agent.terminalId
        const nodeList: string =
            agent.nodes.length > 0
                ? agent.nodes.map((n: {nodeId: string; title: string}) => `${n.title} (${n.nodeId})`).join(', ')
                : '(no nodes created)'
        const statusLabel: string = agent.status === 'exited' && agent.exitCode !== null
            ? `exited:${agent.exitCode}`
            : agent.status
        parts.push(`- ${name} [${statusLabel}]: ${nodeList}`)
        if (agent.lastOutput) {
            parts.push(`Last output: ${agent.lastOutput}`)
        }
    }

    if (stillWaitingOn && stillWaitingOn.length > 0) {
        parts.push(`Still waiting on: ${stillWaitingOn.join(', ')}`)
        parts.push('Be patient! Stop and wait for agents to finish, you will be automatically sent a message by when they finish')
    }

    parts.push('Please use close_agent to close agents you are fully satisfied with. Leave agents open if their work has potential concerns that warrant human review.')

    return parts.join(' ')
}

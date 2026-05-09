/**
 * MCP Tool: close_agent
 * Closes an agent terminal — same path as clicking the red traffic light button.
 *
 * Self-close (agent closing itself): no checks, always allowed.
 * Cross-close (agent closing another): requires the target to have created
 * at least one progress node, so work isn't silently discarded.
 */

import {agentRuntime, type TerminalRecord, type TerminalId} from '@vt/agent-runtime'
import {type McpToolResponse, buildJsonResponse} from '../../core/types'
import {getNewNodesForAgent} from '../../agents/getNewNodesForAgent'
import {getAgentNodes} from '../../agents/agentNodeIndex'
import {getAgentStatus} from '../../agents/isAgentComplete'
import {type StopHookResult} from '@vt/agent-runtime'
import {getMcpGraph} from '../../config/mcp-graph-bridge'

export interface CloseAgentParams {
    terminalId: string
    callerTerminalId: string
    forceWithReason?: string
}

export async function closeAgentTool({terminalId, callerTerminalId, forceWithReason}: CloseAgentParams): Promise<McpToolResponse> {
    const isSelfClose: boolean = callerTerminalId === terminalId

    // Stop gate: audit before allowing self-close (BF-042: derives skill path at audit time)
    if (isSelfClose) {
        const graph: import('@vt/graph-model/graph').Graph = await getMcpGraph()
        const records: readonly TerminalRecord[] = agentRuntime.getTerminalRecords()
        const hookResult: StopHookResult = await agentRuntime.runStopHooks(terminalId, graph, records)
        if (!hookResult.passed) {
            return buildJsonResponse({
                success: false,
                error: hookResult.message ?? 'Stop gate hooks failed'
            }, true)
        }
    }

    if (!isSelfClose) {
        const targetRecord: TerminalRecord | undefined = agentRuntime.getTerminalRecords().find(
            (r: TerminalRecord) => r.terminalId === terminalId
        )

        if (!targetRecord) {
            return buildJsonResponse({
                success: false,
                error: `Cannot close agent "${terminalId}": agent doesn't exist or has already exited.`
            }, true)
        }

        // Guard: refuse to close a non-idle agent unless force-overridden with reason
        const status: string = getAgentStatus(targetRecord)
        if (status === 'running' && !forceWithReason) {
            return buildJsonResponse({
                success: false,
                error: `Cannot close agent "${terminalId}": agent is still running. Send them a message first to check if they have remaining work, then retry with forceWithReason explaining why you're closing a running agent.`
            }, true)
        }

        const agentName: string | undefined = targetRecord.terminalData.agentName
        const indexedNodes: readonly {readonly nodeId: string; readonly title: string}[] = getAgentNodes(terminalId)
        const graphMatchedNodes: Array<{nodeId: string; title: string}> = getNewNodesForAgent(await getMcpGraph(), agentName, targetRecord.spawnedAt)
        const allNodesById: Map<string, {nodeId: string; title: string}> = new Map(
            [...indexedNodes, ...graphMatchedNodes].map((node) => [node.nodeId, node])
        )

        if (allNodesById.size === 0) {
            return buildJsonResponse({
                success: false,
                error: `Cannot close agent "${terminalId}": this agent has not produced any nodes yet. Use send_message to nudge them to create a progress node or provide any other necessary guidance.`
            }, true)
        }
    }

    // Headless agents: shared close path (handles both running + exited)
    const headlessResult: {closed: true; wasRunning: boolean} | {closed: false} = agentRuntime.closeHeadlessAgent(terminalId as TerminalId)
    if (headlessResult.closed) {
        return buildJsonResponse({
            success: true,
            terminalId,
            message: headlessResult.wasRunning
                ? `Successfully closed headless agent: ${terminalId}`
                : `Successfully cleaned up exited headless agent: ${terminalId}`
        })
    }

    // Interactive agents: close via UI bridge (removes xterm.js terminal in
    // Electron; no-op when running headless under vt-mcpd, where there is no UI).
    agentRuntime.getRuntimeUI().closeTerminalById?.(terminalId)
    return buildJsonResponse({
        success: true,
        terminalId,
        message: `Successfully closed agent terminal: ${terminalId}`
    })
}

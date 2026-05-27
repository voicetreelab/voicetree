/**
 * MCP Tool: close_agent
 * Closes an agent terminal — same path as clicking the red traffic light button.
 *
 * Self-close (agent closing itself): no checks, always allowed.
 * Cross-close (agent closing another): requires the target to have created
 * at least one progress node, so work isn't silently discarded.
 */

import type {Graph} from '@vt/graph-model/graph'
import {type McpToolResponse, buildJsonResponse} from '../toolResponse'
import {getAgentNodes, getAgentStatus, getNewNodesForAgentIdentities} from '../agentDependencies'
import {getMcpGraphSnapshot} from '../mcpConfigDependencies'
import {
    closeHeadlessTerminal,
    closeInteractiveTerminal,
    findTerminalRecord,
    listTerminalRecords,
    runTerminalStopHooks,
    type StopHookResult,
    type TerminalId,
    type TerminalRecord,
} from './agentControlRuntime'

export interface CloseAgentParams {
    terminalId: string
    callerTerminalId: string
    forceWithReason?: string
}

type AgentNode = {
    readonly nodeId: string
    readonly title: string
}

type SelfCloseAuditPayload = {
    readonly terminalId: string
    readonly graph: Graph
    readonly records: readonly TerminalRecord[]
}

type CloseAgentState =
    | {
        readonly kind: 'self-close'
        readonly records: readonly TerminalRecord[]
        readonly targetRecord: TerminalRecord | undefined
        readonly auditPayload: SelfCloseAuditPayload
    }
    | {
        readonly kind: 'cross-close'
        readonly targetRecord: TerminalRecord | undefined
        readonly progressNodes: readonly AgentNode[] | null
    }

type CloseEffectAction =
    | {
        readonly kind: 'close-interactive'
        readonly terminalId: string
        readonly record: TerminalRecord | undefined
        readonly nodes: readonly AgentNode[]
    }
    | {
        readonly kind: 'close-headless'
        readonly terminalId: string
        readonly record: TerminalRecord
        readonly nodes: readonly AgentNode[]
    }
    | {
        readonly kind: 'cleanup-already-exited'
        readonly terminalId: string
        readonly record: TerminalRecord
        readonly nodes: readonly AgentNode[]
    }

type CloseAction =
    | {
        readonly kind: 'audit-self-close'
        readonly auditPayload: SelfCloseAuditPayload
        readonly next: CloseEffectAction
    }
    | {readonly kind: 'reject-not-found'; readonly terminalId: string}
    | {readonly kind: 'reject-running-no-force'; readonly terminalId: string}
    | {readonly kind: 'reject-no-progress-nodes'; readonly terminalId: string}
    | CloseEffectAction

function shouldRejectRunningNoForce(record: TerminalRecord, forceWithReason: string | undefined): boolean {
    return getAgentStatus(record) === 'running' && !forceWithReason
}

function progressNodesForAgent(graph: Graph, record: TerminalRecord): readonly AgentNode[] {
    const indexedNodes: readonly AgentNode[] = getAgentNodes(record.terminalId)
    const graphMatchedNodes: readonly AgentNode[] = getNewNodesForAgentIdentities(
        graph,
        [record.terminalData.agentName, record.terminalId],
        record.spawnedAt
    )
    return Array.from(
        new Map([...indexedNodes, ...graphMatchedNodes].map((node: AgentNode) => [node.nodeId, node])).values()
    )
}

function closeEffectFor(terminalId: string, record: TerminalRecord | undefined, nodes: readonly AgentNode[]): CloseEffectAction {
    if (!record) {
        return {kind: 'close-interactive', terminalId, record, nodes}
    }
    if (record.terminalData.isHeadless && record.status === 'exited') {
        return {kind: 'cleanup-already-exited', terminalId, record, nodes}
    }
    if (record.terminalData.isHeadless) {
        return {kind: 'close-headless', terminalId, record, nodes}
    }
    return {kind: 'close-interactive', terminalId, record, nodes}
}

async function readCloseAgentState({terminalId, callerTerminalId, forceWithReason}: CloseAgentParams): Promise<CloseAgentState> {
    if (callerTerminalId === terminalId) {
        const graph: Graph = (await getMcpGraphSnapshot()).graph
        const records: readonly TerminalRecord[] = listTerminalRecords()
        const targetRecord: TerminalRecord | undefined = findTerminalRecord(terminalId, records)
        return {
            kind: 'self-close',
            records,
            targetRecord,
            auditPayload: {terminalId, graph, records},
        }
    }

    const records: readonly TerminalRecord[] = listTerminalRecords()
    const targetRecord: TerminalRecord | undefined = findTerminalRecord(terminalId, records)

    if (!targetRecord || shouldRejectRunningNoForce(targetRecord, forceWithReason)) {
        return {kind: 'cross-close', targetRecord, progressNodes: null}
    }

    return {
        kind: 'cross-close',
        targetRecord,
        progressNodes: progressNodesForAgent((await getMcpGraphSnapshot()).graph, targetRecord),
    }
}

function decideCloseAction(state: CloseAgentState, {terminalId, forceWithReason}: CloseAgentParams): CloseAction {
    if (state.kind === 'self-close') {
        return {
            kind: 'audit-self-close',
            auditPayload: state.auditPayload,
            next: closeEffectFor(terminalId, state.targetRecord, []),
        }
    }

    if (!state.targetRecord) {
        return {kind: 'reject-not-found', terminalId}
    }

    if (shouldRejectRunningNoForce(state.targetRecord, forceWithReason)) {
        return {kind: 'reject-running-no-force', terminalId}
    }

    const progressNodes: readonly AgentNode[] = state.progressNodes ?? []
    if (progressNodes.length === 0) {
        return {kind: 'reject-no-progress-nodes', terminalId}
    }

    return closeEffectFor(terminalId, state.targetRecord, progressNodes)
}

function buildRejectResponse(action: Extract<CloseAction, {kind: 'reject-not-found' | 'reject-running-no-force' | 'reject-no-progress-nodes'}>): McpToolResponse {
    switch (action.kind) {
        case 'reject-not-found':
            return buildJsonResponse({
                success: false,
                error: `Cannot close agent "${action.terminalId}": agent doesn't exist or has already exited.`
            }, true)
        case 'reject-running-no-force':
            return buildJsonResponse({
                success: false,
                error: `Cannot close agent "${action.terminalId}": agent is still running. Send them a message first to check if they have remaining work, then retry with forceWithReason explaining why you're closing a running agent.`
            }, true)
        case 'reject-no-progress-nodes':
            return buildJsonResponse({
                success: false,
                error: `Cannot close agent "${action.terminalId}": this agent has not produced any nodes yet. Use send_message to nudge them to create a progress node or provide any other necessary guidance.`
            }, true)
    }
}

function buildInteractiveCloseResponse(terminalId: string): McpToolResponse {
    return buildJsonResponse({
        success: true,
        terminalId,
        message: `Successfully closed agent terminal: ${terminalId}`
    })
}

function closeHeadlessOrFallback(terminalId: string): McpToolResponse {
    const headlessResult: {closed: true; wasRunning: boolean} | {closed: false} = closeHeadlessTerminal(terminalId as TerminalId)
    if (headlessResult.closed) {
        return buildJsonResponse({
            success: true,
            terminalId,
            message: headlessResult.wasRunning
                ? `Successfully closed headless agent: ${terminalId}`
                : `Successfully cleaned up exited headless agent: ${terminalId}`
        })
    }

    closeInteractiveTerminal(terminalId)
    return buildInteractiveCloseResponse(terminalId)
}

function performCloseEffect(action: CloseEffectAction): McpToolResponse {
    switch (action.kind) {
        case 'close-interactive':
            closeInteractiveTerminal(action.terminalId)
            closeHeadlessTerminal(action.terminalId as TerminalId)
            return buildInteractiveCloseResponse(action.terminalId)
        case 'close-headless':
        case 'cleanup-already-exited':
            return closeHeadlessOrFallback(action.terminalId)
    }
}

async function performCloseAction(action: CloseAction): Promise<McpToolResponse> {
    switch (action.kind) {
        case 'audit-self-close': {
            const hookResult: StopHookResult = await runTerminalStopHooks(
                action.auditPayload.terminalId,
                action.auditPayload.graph,
                action.auditPayload.records
            )
            if (!hookResult.passed) {
                return buildJsonResponse({
                    success: false,
                    error: hookResult.message ?? 'Stop gate hooks failed'
                }, true)
            }
            return performCloseEffect(action.next)
        }
        case 'reject-not-found':
        case 'reject-running-no-force':
        case 'reject-no-progress-nodes':
            return buildRejectResponse(action)
        case 'close-interactive':
        case 'close-headless':
        case 'cleanup-already-exited':
            return performCloseEffect(action)
    }
}

export async function closeAgentTool(params: CloseAgentParams): Promise<McpToolResponse> {
    const state: CloseAgentState = await readCloseAgentState(params)
    return performCloseAction(decideCloseAction(state, params))
}

/**
 * MCP Tool: close_agent
 * Closes an agent terminal — same path as clicking the red traffic light button.
 *
 * Self-close (agent closing itself): no checks, always allowed.
 * Cross-close (agent closing another): by default requires the target to have
 * created at least one progress node, so work isn't silently discarded.
 * Passing `forceWithReason` bypasses both the running gate and the
 * no-progress-nodes gate (for genuinely no-output agents, e.g. turn-based
 * simulation actors), matching the documented `--force` behavior.
 */

import type {Graph} from '@vt/graph-model/graph'
import {type McpToolResponse, buildJsonResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'
import {getAgentNodes} from './completion/agentNodeIndex.ts'
import {getAgentStatus} from './completion/isAgentComplete.ts'
import {getNewNodesForAgentIdentities} from './completion/getNewNodesForAgent.ts'
import {getMcpGraph} from '@vt/vt-daemon/config/graphBridge.ts'
import type {GraphBridge} from '@vt/vt-daemon/config/mcpBridges.ts'
import {
    closeHeadlessTerminal,
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
        [record.terminalId],
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

async function readCloseAgentState(
    {terminalId, callerTerminalId, forceWithReason}: CloseAgentParams,
    bridge: GraphBridge,
): Promise<CloseAgentState> {
    if (callerTerminalId === terminalId) {
        const graph: Graph = await getMcpGraph(bridge)
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
        progressNodes: progressNodesForAgent(await getMcpGraph(bridge), targetRecord),
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
    if (progressNodes.length === 0 && !forceWithReason) {
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

async function closeHeadlessOrFallback(terminalId: string): Promise<McpToolResponse> {
    // Post-BF-376: every tmux-backed terminal (interactive or headless) is
    // closed through `closeHeadlessAgent` — the function name is historical;
    // it kills the tmux session and removes the registry row regardless of
    // `isHeadless`. The `closed: false` branch means there was nothing to
    // close (no tmux runtime, no registry row), which we surface as a
    // successful no-op response. There is no separate UI-close call site
    // anymore: receivers subscribe to the `terminal-registry` SSE topic and
    // drop their panel when `terminal-removed` arrives (design.md §4).
    const headlessResult: {closed: true; wasRunning: boolean} | {closed: false} = await closeHeadlessTerminal(terminalId as TerminalId)
    if (headlessResult.closed) {
        return buildJsonResponse({
            success: true,
            terminalId,
            message: headlessResult.wasRunning
                ? `Successfully closed headless agent: ${terminalId}`
                : `Successfully cleaned up exited headless agent: ${terminalId}`
        })
    }
    return buildInteractiveCloseResponse(terminalId)
}

async function performCloseEffect(action: CloseEffectAction): Promise<McpToolResponse> {
    switch (action.kind) {
        case 'close-interactive':
            // Interactive tmux-backed terminals share the same teardown path
            // as headless: `closeHeadlessAgent` finds the tmux runtime entry
            // (`hasTmuxHeadlessRuntime` is misnamed — it indexes every
            // tmux-backed terminal), kills the session, and removes the
            // registry row. The row-removal publishes `terminal-removed` on
            // the new `terminal-registry` topic; the renderer's SSE
            // subscription drops the panel from that event alone (design.md
            // §4 — `closeTerminalById is derivable from terminal-removed`).
            await closeHeadlessTerminal(action.terminalId as TerminalId)
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

export async function closeAgentTool(params: CloseAgentParams, bridge: GraphBridge): Promise<McpToolResponse> {
    const state: CloseAgentState = await readCloseAgentState(params, bridge)
    return performCloseAction(decideCloseAction(state, params))
}

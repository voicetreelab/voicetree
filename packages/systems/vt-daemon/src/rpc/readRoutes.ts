// Read-state RPC routes (3): getTerminalRecords, getUnseenNodesForTerminal,
// getExistingAgentNames. All return readonly snapshots.

import {z} from 'zod'

import {terminalRuntimeSurface as agentRuntime} from "@vt/vt-daemon/agent-runtime/agent-control/terminalRuntimeSurface.ts"
import {getUnseenNodesForTerminal} from '../agent-runtime/inject/get-unseen-nodes-for-terminal.ts'
import type {
    GetTerminalRecords,
    GetUnseenNodesForTerminal,
    GetExistingAgentNames,
} from '@vt/vt-daemon-protocol'

import {type RpcRoute} from './RpcRoute.ts'
import {buildJsonResponse, type ToolResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'

const getTerminalRecordsRoute: RpcRoute = {
    name: 'getTerminalRecords',
    handler: async (): Promise<ToolResponse> => {
        const result: GetTerminalRecords.Response = agentRuntime.getTerminalRecords()
        return buildJsonResponse(result)
    },
}

const getUnseenNodesForTerminalRoute: RpcRoute = {
    name: 'getUnseenNodesForTerminal',
    inputShape: {
        terminalId: z.string(),
    },
    handler: async (args: Record<string, unknown>): Promise<ToolResponse> => {
        const req: GetUnseenNodesForTerminal.Request = args as unknown as GetUnseenNodesForTerminal.Request
        // The local helper returns the legacy UnseenNode shape; the wire
        // contract narrows to {nodeId,title,contentPreview}. Project before
        // send.
        const raw = await getUnseenNodesForTerminal(req.terminalId)
        const projected: GetUnseenNodesForTerminal.Response = raw.map((n) => ({
            nodeId: n.nodeId,
            title: n.title,
            contentPreview: n.contentPreview,
        }))
        return buildJsonResponse(projected)
    },
}

const getExistingAgentNamesRoute: RpcRoute = {
    name: 'getExistingAgentNames',
    handler: async (): Promise<ToolResponse> => {
        // Agent-runtime returns a Set<string>; wire shape is readonly string[].
        const result: ReadonlySet<string> | readonly string[] = agentRuntime.getExistingAgentNames()
        const wire: GetExistingAgentNames.Response = Array.isArray(result) ? result : Array.from(result)
        return buildJsonResponse(wire)
    },
}

export const READ_ROUTES: readonly RpcRoute[] = [
    getTerminalRecordsRoute,
    getUnseenNodesForTerminalRoute,
    getExistingAgentNamesRoute,
] as const

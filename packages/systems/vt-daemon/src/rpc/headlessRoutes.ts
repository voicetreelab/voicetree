// Headless-agent RPC routes (2): closeHeadlessAgent, getHeadlessAgentOutput.

import {z} from 'zod'

import type {TerminalId} from "@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts"
import {closeHeadlessAgent, getHeadlessAgentOutput} from '../agent-runtime/headless/headlessAgentManager.ts'
import type {
    CloseHeadlessAgent,
    GetHeadlessAgentOutput,
} from '@vt/vt-daemon-protocol'

import {type RpcRoute} from './RpcRoute.ts'
import {buildJsonResponse, type ToolResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'

const closeHeadlessAgentRoute: RpcRoute = {
    name: 'closeHeadlessAgent',
    inputShape: {
        terminalId: z.string(),
    },
    handler: async (args: Record<string, unknown>): Promise<ToolResponse> => {
        const req: CloseHeadlessAgent.Request = args as unknown as CloseHeadlessAgent.Request
        const result: CloseHeadlessAgent.Response = await closeHeadlessAgent(req.terminalId as TerminalId)
        return buildJsonResponse(result)
    },
}

const getHeadlessAgentOutputRoute: RpcRoute = {
    name: 'getHeadlessAgentOutput',
    inputShape: {
        terminalId: z.string(),
    },
    handler: async (args: Record<string, unknown>): Promise<ToolResponse> => {
        const req: GetHeadlessAgentOutput.Request = args as unknown as GetHeadlessAgentOutput.Request
        const result: GetHeadlessAgentOutput.Response = getHeadlessAgentOutput(req.terminalId)
        return buildJsonResponse(result)
    },
}

export const HEADLESS_ROUTES: readonly RpcRoute[] = [
    closeHeadlessAgentRoute,
    getHeadlessAgentOutputRoute,
] as const

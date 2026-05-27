// Inject / send RPC routes (2): sendTextToTerminal, injectNodesIntoTerminal.

import {z} from 'zod'

import {sendTextToTerminal} from '../agent-runtime/inject/send-text-to-terminal.ts'
import {injectNodesIntoTerminal} from '../agent-runtime/inject/inject-nodes-into-terminal.ts'
import type {
    SendTextToTerminal,
    InjectNodesIntoTerminal,
} from '@vt/vt-daemon-protocol'

import {type RpcRoute} from './RpcRoute.ts'
import {buildJsonResponse, type McpToolResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'

const sendTextToTerminalRoute: RpcRoute = {
    name: 'sendTextToTerminal',
    inputShape: {
        terminalId: z.string(),
        text: z.string(),
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResponse> => {
        const req: SendTextToTerminal.Request = args as unknown as SendTextToTerminal.Request
        const result: SendTextToTerminal.Response = await sendTextToTerminal(req.terminalId, req.text)
        return buildJsonResponse(result)
    },
}

const injectNodesIntoTerminalRoute: RpcRoute = {
    name: 'injectNodesIntoTerminal',
    inputShape: {
        terminalId: z.string(),
        nodeIds: z.array(z.string()),
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResponse> => {
        const req: InjectNodesIntoTerminal.Request = args as unknown as InjectNodesIntoTerminal.Request
        const result: InjectNodesIntoTerminal.Response = await injectNodesIntoTerminal(req.terminalId, [...req.nodeIds])
        return buildJsonResponse(result)
    },
}

export const INJECT_ROUTES: readonly RpcRoute[] = [
    sendTextToTerminalRoute,
    injectNodesIntoTerminalRoute,
] as const

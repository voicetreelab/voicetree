// Tmux-unclaimed RPC routes (3): attach/list/kill. Recovery picker source.

import {z} from 'zod'

import {terminalRuntimeSurface as agentRuntime} from "@vt/vt-daemon/tools/agent-control/terminalRuntimeSurface.ts"
import type {
    AttachUnclaimedTmuxSession,
    ListUnclaimedTmuxSessions,
    KillUnclaimedTmuxSession,
} from '@vt/vt-daemon-protocol'

import {type RpcRoute} from './RpcRoute.ts'
import {buildJsonResponse, type McpToolResponse} from '../tools/toolResponse.ts'

const attachUnclaimedTmuxSessionRoute: RpcRoute = {
    name: 'attachUnclaimedTmuxSession',
    inputShape: {
        sessionName: z.string(),
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResponse> => {
        const req: AttachUnclaimedTmuxSession.Request = args as unknown as AttachUnclaimedTmuxSession.Request
        const result: AttachUnclaimedTmuxSession.Response = await agentRuntime.attachUnclaimedTmuxSession(req.sessionName)
        return buildJsonResponse(result)
    },
}

const listUnclaimedTmuxSessionsRoute: RpcRoute = {
    name: 'listUnclaimedTmuxSessions',
    handler: async (): Promise<McpToolResponse> => {
        const result: ListUnclaimedTmuxSessions.Response = await agentRuntime.listUnclaimedTmuxSessions()
        return buildJsonResponse(result)
    },
}

const killUnclaimedTmuxSessionRoute: RpcRoute = {
    name: 'killUnclaimedTmuxSession',
    inputShape: {
        sessionName: z.string(),
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResponse> => {
        const req: KillUnclaimedTmuxSession.Request = args as unknown as KillUnclaimedTmuxSession.Request
        const result: KillUnclaimedTmuxSession.Response = await agentRuntime.killUnclaimedTmuxSession(req.sessionName)
        return buildJsonResponse(result)
    },
}

export const TMUX_UNCLAIMED_ROUTES: readonly RpcRoute[] = [
    attachUnclaimedTmuxSessionRoute,
    listUnclaimedTmuxSessionsRoute,
    killUnclaimedTmuxSessionRoute,
] as const

// Recovery RPC routes (3): discoverRecoverableAgentSessions,
// resumePersistedAgentSession, forkAgentSession.
//
// Note on `attach` projection: agent-runtime's `AttachCapability` carries the
// full `UnclaimedTmuxSession` object (`{session}`), but the wire contract
// narrows it to just `{sessionName}` (design.md §1 — recovery picker reads
// the session name and refetches detail via `listUnclaimedTmuxSessions` if
// it needs richer data). Project before send so the wire stays narrow.

import {z} from 'zod'

import type {TerminalId} from "@vt/vt-daemon/terminals/terminal-registry/types.ts"
import {discoverRecoverableAgentSessions} from '../agents/recovery/discovery.ts'
import {resumePersistedAgentSession} from '../agents/recovery/resumePersistedAgentSession.ts'
import {forkAgentSession} from '../agents/recovery/forkAgentSession.ts'
import type {
    DiscoverRecoverableAgentSessions,
    ResumePersistedAgentSession,
    ForkAgentSession,
    RecoverableAgentSession as WireRecoverableAgentSession,
} from '@vt/vt-daemon-protocol'

import {type RpcRoute} from './RpcRoute.ts'
import {buildJsonResponse, type McpToolResponse} from '../tools/toolResponse.ts'

const discoverRecoverableAgentSessionsRoute: RpcRoute = {
    name: 'discoverRecoverableAgentSessions',
    handler: async (): Promise<McpToolResponse> => {
        const sessions = await discoverRecoverableAgentSessions()
        const projected: DiscoverRecoverableAgentSessions.Response = sessions.map((s): WireRecoverableAgentSession => ({
            terminalId: s.terminalId,
            agentName: s.agentName,
            metadataPath: s.metadataPath,
            terminalData: s.terminalData,
            isClaimed: s.isClaimed,
            attach: s.attach ? {sessionName: s.attach.session.sessionName} : undefined,
            resume: s.resume ? {cliType: s.resume.cliType} : undefined,
        }))
        return buildJsonResponse(projected)
    },
}

const resumePersistedAgentSessionRoute: RpcRoute = {
    name: 'resumePersistedAgentSession',
    inputShape: {
        terminalId: z.string(),
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResponse> => {
        const req: ResumePersistedAgentSession.Request = args as unknown as ResumePersistedAgentSession.Request
        const result: ResumePersistedAgentSession.Response = await resumePersistedAgentSession(req.terminalId as TerminalId)
        return buildJsonResponse(result)
    },
}

const forkAgentSessionRoute: RpcRoute = {
    name: 'forkAgentSession',
    inputShape: {
        sourceTerminalId: z.string(),
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResponse> => {
        const req: ForkAgentSession.Request = args as unknown as ForkAgentSession.Request
        const result: ForkAgentSession.Response = await forkAgentSession(req.sourceTerminalId as TerminalId)
        return buildJsonResponse(result)
    },
}

export const RECOVERY_ROUTES: readonly RpcRoute[] = [
    discoverRecoverableAgentSessionsRoute,
    resumePersistedAgentSessionRoute,
    forkAgentSessionRoute,
] as const

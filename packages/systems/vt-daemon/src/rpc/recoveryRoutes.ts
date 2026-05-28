// Recovery RPC routes (4): discoverRecoverableAgentSessions,
// resumePersistedAgentSession, forkAgentSession, removePersistedAgentRecord.
//
// Note on `attach` projection: agent-runtime's `AttachCapability` carries the
// full `UnclaimedTmuxSession` object (`{session}`), but the wire contract
// narrows it to just `{sessionName}` (design.md §1 — recovery picker reads
// the session name and refetches detail via `listUnclaimedTmuxSessions` if
// it needs richer data). Project before send so the wire stays narrow.

import {z} from 'zod'

import type {TerminalId} from "@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts"
import {discoverRecoverableAgentSessions} from '../agent-runtime/recovery/discovery.ts'
import {resumePersistedAgentSession} from '../agent-runtime/recovery/resumePersistedAgentSession.ts'
import {forkAgentSession} from '../agent-runtime/recovery/forkAgentSession.ts'
import {removePersistedAgentRecord} from '../agent-runtime/recovery/removePersistedAgentRecord.ts'
import type {
    DiscoverRecoverableAgentSessions,
    ResumePersistedAgentSession,
    ForkAgentSession,
    RemovePersistedAgentRecord,
    RecoverableAgentSession as WireRecoverableAgentSession,
} from '@vt/vt-daemon-protocol'

import {type RpcRoute} from './RpcRoute.ts'
import {buildJsonResponse, type McpToolResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'

const discoverRecoverableAgentSessionsRoute: RpcRoute = {
    name: 'discoverRecoverableAgentSessions',
    inputShape: {
        // `null` ⇒ disable cutoff (renderer's "show older"); `undefined` ⇒ daemon default;
        // a positive finite number ⇒ override the horizon for this call.
        horizonMs: z.union([z.number(), z.null()]).optional(),
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResponse> => {
        const req: DiscoverRecoverableAgentSessions.Request = args as unknown as DiscoverRecoverableAgentSessions.Request
        const sessions = await discoverRecoverableAgentSessions(undefined, {horizonMs: req.horizonMs})
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

const removePersistedAgentRecordRoute: RpcRoute = {
    name: 'removePersistedAgentRecord',
    inputShape: {
        terminalId: z.string(),
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResponse> => {
        const req: RemovePersistedAgentRecord.Request = args as unknown as RemovePersistedAgentRecord.Request
        const result: RemovePersistedAgentRecord.Response = await removePersistedAgentRecord(req.terminalId)
        return buildJsonResponse(result)
    },
}

export const RECOVERY_ROUTES: readonly RpcRoute[] = [
    discoverRecoverableAgentSessionsRoute,
    resumePersistedAgentSessionRoute,
    forkAgentSessionRoute,
    removePersistedAgentRecordRoute,
] as const

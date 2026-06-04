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
    TerminalRegistryEvent,
} from '@vt/vt-daemon-protocol'
import {publishTerminalRegistryEvent} from '../agent-runtime/terminals/terminal-registry/terminal-registry-publisher.ts'

import {type RpcRoute} from './RpcRoute.ts'
import {buildJsonResponse, type ToolResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'

/**
 * The normal spawn path (launchTerminalSpawn) emits `terminal-ui-launch` after
 * creating the tmux session so the renderer mounts the terminal window. The
 * recovery functions create the session (via spawnTmuxBackedTerminal) but never
 * emitted it, so a resumed/forked agent stayed invisible in browser-mode even
 * once discovery surfaced it. Map a successful recovery result to the event the
 * renderer needs; the route fires it at the edge (the session already exists,
 * so the renderer's WS attach lands on a live pane). Non-`spawned` results
 * (stale row, no native session, spawn failure) launch nothing.
 */
export function uiLaunchEventForRecoveryResult(
    result: ResumePersistedAgentSession.Response | ForkAgentSession.Response,
): Extract<TerminalRegistryEvent, {type: 'terminal-ui-launch'}> | null {
    if (result.kind !== 'spawned') return null
    return {
        type: 'terminal-ui-launch',
        nodeId: result.terminalData.attachedToContextNodeId,
        terminalData: result.terminalData,
        skipFitAnimation: true,
    }
}

const discoverRecoverableAgentSessionsRoute: RpcRoute = {
    name: 'discoverRecoverableAgentSessions',
    inputShape: {
        // `null` ⇒ disable cutoff (renderer's "show older"); `undefined` ⇒ daemon default;
        // a positive finite number ⇒ override the horizon for this call.
        horizonMs: z.union([z.number(), z.null()]).optional(),
    },
    handler: async (args: Record<string, unknown>): Promise<ToolResponse> => {
        const req: DiscoverRecoverableAgentSessions.Request = args as unknown as DiscoverRecoverableAgentSessions.Request
        const sessions = await discoverRecoverableAgentSessions(undefined, {horizonMs: req.horizonMs})
        const projected: DiscoverRecoverableAgentSessions.Response = sessions.map((s): WireRecoverableAgentSession => ({
            terminalId: s.terminalId,
            agentName: s.agentName,
            metadataPath: s.metadataPath,
            terminalData: s.terminalData,
            isClaimed: s.isClaimed,
            status: s.status,
            attach: s.attach ? {session: s.attach.session} : undefined,
            resume: s.resume ? {cliType: s.resume.cliType} : undefined,
            worktreeName: s.worktreeName,
            title: s.title,
            agentTypeName: s.agentTypeName,
            startedAt: s.startedAt,
            endedAt: s.endedAt,
            closedAt: s.closedAt,
            killReason: s.killReason,
        }))
        return buildJsonResponse(projected)
    },
}

const resumePersistedAgentSessionRoute: RpcRoute = {
    name: 'resumePersistedAgentSession',
    inputShape: {
        terminalId: z.string(),
    },
    handler: async (args: Record<string, unknown>): Promise<ToolResponse> => {
        const req: ResumePersistedAgentSession.Request = args as unknown as ResumePersistedAgentSession.Request
        const result: ResumePersistedAgentSession.Response = await resumePersistedAgentSession(req.terminalId as TerminalId)
        const launch = uiLaunchEventForRecoveryResult(result)
        if (launch) publishTerminalRegistryEvent(launch)
        return buildJsonResponse(result)
    },
}

const forkAgentSessionRoute: RpcRoute = {
    name: 'forkAgentSession',
    inputShape: {
        sourceTerminalId: z.string(),
    },
    handler: async (args: Record<string, unknown>): Promise<ToolResponse> => {
        const req: ForkAgentSession.Request = args as unknown as ForkAgentSession.Request
        const result: ForkAgentSession.Response = await forkAgentSession(req.sourceTerminalId as TerminalId)
        const launch = uiLaunchEventForRecoveryResult(result)
        if (launch) publishTerminalRegistryEvent(launch)
        return buildJsonResponse(result)
    },
}

const removePersistedAgentRecordRoute: RpcRoute = {
    name: 'removePersistedAgentRecord',
    inputShape: {
        terminalId: z.string(),
    },
    handler: async (args: Record<string, unknown>): Promise<ToolResponse> => {
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

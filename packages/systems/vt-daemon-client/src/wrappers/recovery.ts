/**
 * Typed RPC wrappers for the "recovery" domain — the four routes the
 * recovery picker uses to discover, resume, fork, and permanently delete
 * persisted agent sessions. Mirrors design.md §1 Recovery group.
 */

import type {
    DiscoverRecoverableAgentSessions,
    ForkAgentSession,
    RecoverableAgentSession,
    RemovePersistedAgentRecord,
    ResumePersistedAgentSession,
} from '@vt/vt-daemon-protocol'

import type {VtDaemonClient} from '../VtDaemonClient.ts'
import {asParams} from './params.ts'

export async function discoverRecoverableAgentSessions(
    client: VtDaemonClient,
    request: DiscoverRecoverableAgentSessions.Request = {},
): Promise<readonly RecoverableAgentSession[]> {
    return client.rpc<readonly RecoverableAgentSession[]>(
        'discoverRecoverableAgentSessions',
        asParams(request),
    )
}

export async function resumePersistedAgentSession(
    client: VtDaemonClient,
    request: ResumePersistedAgentSession.Request,
): Promise<ResumePersistedAgentSession.Response> {
    return client.rpc<ResumePersistedAgentSession.Response>(
        'resumePersistedAgentSession',
        asParams(request),
    )
}

export async function forkAgentSession(
    client: VtDaemonClient,
    request: ForkAgentSession.Request,
): Promise<ForkAgentSession.Response> {
    return client.rpc<ForkAgentSession.Response>('forkAgentSession', asParams(request))
}

export async function removePersistedAgentRecord(
    client: VtDaemonClient,
    request: RemovePersistedAgentRecord.Request,
): Promise<RemovePersistedAgentRecord.Response> {
    return client.rpc<RemovePersistedAgentRecord.Response>(
        'removePersistedAgentRecord',
        asParams(request),
    )
}

export interface RecoveryFacade {
    readonly discoverRecoverableAgentSessions: (
        request?: DiscoverRecoverableAgentSessions.Request,
    ) => Promise<readonly RecoverableAgentSession[]>
    readonly resumePersistedAgentSession: (
        request: ResumePersistedAgentSession.Request,
    ) => Promise<ResumePersistedAgentSession.Response>
    readonly forkAgentSession: (
        request: ForkAgentSession.Request,
    ) => Promise<ForkAgentSession.Response>
    readonly removePersistedAgentRecord: (
        request: RemovePersistedAgentRecord.Request,
    ) => Promise<RemovePersistedAgentRecord.Response>
}

export function bindRecoveryFacade(client: VtDaemonClient): RecoveryFacade {
    return {
        discoverRecoverableAgentSessions: (request) =>
            discoverRecoverableAgentSessions(client, request),
        resumePersistedAgentSession: (request) =>
            resumePersistedAgentSession(client, request),
        forkAgentSession: (request) => forkAgentSession(client, request),
        removePersistedAgentRecord: (request) =>
            removePersistedAgentRecord(client, request),
    }
}

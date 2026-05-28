/**
 * Typed RPC wrappers for the "tmuxUnclaimed" domain — the three routes
 * the recovery picker uses to list, attach, or kill tmux sessions VTD
 * has no live registry row for. Mirrors design.md §1 Tmux-unclaimed
 * group.
 */

import type {
    AttachUnclaimedTmuxResult,
    AttachUnclaimedTmuxSession,
    KillUnclaimedTmuxResult,
    KillUnclaimedTmuxSession,
    ListUnclaimedTmuxSessions,
    UnclaimedTmuxSession,
} from '@vt/vt-daemon-protocol'

import type {VtDaemonClient} from '../VtDaemonClient.ts'
import {asParams} from './params.ts'

export async function attachUnclaimedTmuxSession(
    client: VtDaemonClient,
    request: AttachUnclaimedTmuxSession.Request,
): Promise<AttachUnclaimedTmuxResult> {
    return client.rpc<AttachUnclaimedTmuxResult>(
        'attachUnclaimedTmuxSession',
        asParams(request),
    )
}

export async function listUnclaimedTmuxSessions(
    client: VtDaemonClient,
    request: ListUnclaimedTmuxSessions.Request = {},
): Promise<readonly UnclaimedTmuxSession[]> {
    return client.rpc<readonly UnclaimedTmuxSession[]>(
        'listUnclaimedTmuxSessions',
        asParams(request),
    )
}

export async function killUnclaimedTmuxSession(
    client: VtDaemonClient,
    request: KillUnclaimedTmuxSession.Request,
): Promise<KillUnclaimedTmuxResult> {
    return client.rpc<KillUnclaimedTmuxResult>(
        'killUnclaimedTmuxSession',
        asParams(request),
    )
}

export interface TmuxUnclaimedFacade {
    readonly attachUnclaimedTmuxSession: (
        request: AttachUnclaimedTmuxSession.Request,
    ) => Promise<AttachUnclaimedTmuxResult>
    readonly listUnclaimedTmuxSessions: (
        request?: ListUnclaimedTmuxSessions.Request,
    ) => Promise<readonly UnclaimedTmuxSession[]>
    readonly killUnclaimedTmuxSession: (
        request: KillUnclaimedTmuxSession.Request,
    ) => Promise<KillUnclaimedTmuxResult>
}

export function bindTmuxUnclaimedFacade(client: VtDaemonClient): TmuxUnclaimedFacade {
    return {
        attachUnclaimedTmuxSession: (request) =>
            attachUnclaimedTmuxSession(client, request),
        listUnclaimedTmuxSessions: (request) =>
            listUnclaimedTmuxSessions(client, request),
        killUnclaimedTmuxSession: (request) =>
            killUnclaimedTmuxSession(client, request),
    }
}

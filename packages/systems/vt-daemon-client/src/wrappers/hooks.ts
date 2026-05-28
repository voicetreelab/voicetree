/**
 * Typed RPC wrapper for the "hooks" domain — the single Phase-2-only
 * `dispatchOnNewNodeHooks` route. Disappears when Phase 3 lands the FS
 * watcher in VTD; kept named in the contract today rather than deferred
 * to a phantom future BF (design.md §1 Hook-dispatch entry).
 */

import type {DispatchOnNewNodeHooks} from '@vt/vt-daemon-protocol'

import type {VtDaemonClient} from '../VtDaemonClient.ts'
import {asParams} from './params.ts'

export async function dispatchOnNewNodeHooks(
    client: VtDaemonClient,
    request: DispatchOnNewNodeHooks.Request,
): Promise<void> {
    await client.rpc<null>('dispatchOnNewNodeHooks', asParams(request))
}

export interface HooksFacade {
    readonly dispatchOnNewNodeHooks: (
        request: DispatchOnNewNodeHooks.Request,
    ) => Promise<void>
}

export function bindHooksFacade(client: VtDaemonClient): HooksFacade {
    return {
        dispatchOnNewNodeHooks: (request) => dispatchOnNewNodeHooks(client, request),
    }
}

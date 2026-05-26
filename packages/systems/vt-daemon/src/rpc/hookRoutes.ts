// Hook-dispatch RPC routes (1, Phase-2-only): dispatchOnNewNodeHooks.
//
// Wire contract: Main posts `{delta, hookCommand}`. The in-process function
// also takes a `logHookResult` callback — per design.md §1 that callback is
// intentionally NOT on the wire (it would round-trip log lines for no
// reason). VTD hard-codes a stderr-based logger here so each hook
// dispatch surfaces in the daemon log stream that the parent (Electron /
// CLI ensure-caller) is already tailing.
//
// Phase 3 retires this route entirely: when the FS watcher lands inside
// VTD the hook fan-out moves in-process and the wire route disappears
// (drops the route count from 19 → 18).

import {z} from 'zod'

import {agentRuntime} from '@vt/agent-runtime'
import type {DispatchOnNewNodeHooks} from '@vt/vt-daemon-protocol'
import type {GraphDelta} from '@vt/graph-model/graph'

import {voidRoute, type RpcRoute} from './RpcRoute.ts'

function logHookResult(message: string): void {
    process.stderr.write(`vtd: ${message}\n`)
}

const dispatchOnNewNodeHooksRoute: RpcRoute = {
    name: 'dispatchOnNewNodeHooks',
    // `delta` is the typed GraphDelta from `@vt/graph-model/graph`. Validating
    // its full structure with zod would duplicate the canonical TypeScript
    // type for no win — accept an unknown array here and let agent-runtime's
    // dispatcher consume it.
    inputShape: {
        delta: z.unknown(),
        hookCommand: z.string(),
    },
    handler: voidRoute<DispatchOnNewNodeHooks.Request>((req: DispatchOnNewNodeHooks.Request): void => {
        agentRuntime.dispatchOnNewNodeHooks(req.delta as GraphDelta, req.hookCommand, logHookResult)
    }),
}

export const HOOK_ROUTES: readonly RpcRoute[] = [
    dispatchOnNewNodeHooksRoute,
] as const

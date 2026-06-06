// Registry-management RPC routes (2): removeTerminalFromRegistry,
// patchTerminalRecord.
//
// `patchTerminalRecord` is polymorphic: per design.md §5 it collapses the
// four prior mutators (pinned/minimized/activity/done) into a single route
// keyed by `patch.kind`. The handler exhaustively switches on the
// discriminant and dispatches to the matching agent-runtime mutator;
// every branch publishes its `terminal-record-changed` event inside
// agent-runtime (already wired by S2-R).

import {z} from 'zod'

import {terminalRuntimeSurface as agentRuntime} from "@vt/vt-daemon/agent-runtime/agent-control/terminalRuntimeSurface.ts"
import type {
    RemoveTerminalFromRegistry,
    PatchTerminalRecord,
    TerminalRecordPatch,
} from '@vt/vt-daemon-protocol'

import {voidRoute, type RpcRoute} from './RpcRoute.ts'

const patchShape = z.discriminatedUnion('kind', [
    z.object({kind: z.literal('pinned'), value: z.boolean()}),
    z.object({kind: z.literal('minimized'), value: z.boolean()}),
    z.object({
        kind: z.literal('activity'),
        value: z.object({
            lastOutputTime: z.number().optional(),
            activityCount: z.number().optional(),
        }).passthrough(),
    }),
    z.object({kind: z.literal('done'), value: z.boolean()}),
])

const removeTerminalFromRegistryRoute: RpcRoute = {
    name: 'removeTerminalFromRegistry',
    inputShape: {
        terminalId: z.string(),
    },
    handler: voidRoute<RemoveTerminalFromRegistry.Request>((req: RemoveTerminalFromRegistry.Request): void => {
        agentRuntime.removeTerminalFromRegistry(req.terminalId)
    }),
}

function applyPatch(terminalId: string, patch: TerminalRecordPatch): void {
    switch (patch.kind) {
        case 'pinned':
            agentRuntime.updateTerminalPinned(terminalId, patch.value)
            return
        case 'minimized':
            agentRuntime.updateTerminalMinimized(terminalId, patch.value)
            return
        case 'activity':
            agentRuntime.updateTerminalActivityState(terminalId, patch.value)
            return
        case 'done':
            agentRuntime.updateTerminalIsDone(terminalId, patch.value)
            return
        case 'lifecycle':
        case 'statusPhrase':
            // Outbound-only: the daemon owns lifecycle (computed authoritatively)
            // and statusPhrase (set from an agent's create_graph call) and
            // broadcasts both over the SSE topic. `patchShape` above does not
            // accept these kinds, so validation rejects an inbound one before it
            // reaches here — these cases exist only to keep the switch
            // exhaustive over `TerminalRecordPatch`.
            throw new Error(`${patch.kind} is daemon-authoritative and cannot be set via patchTerminalRecord`)
    }
}

const patchTerminalRecordRoute: RpcRoute = {
    name: 'patchTerminalRecord',
    inputShape: {
        terminalId: z.string(),
        patch: patchShape,
    },
    handler: voidRoute<PatchTerminalRecord.Request>((req: PatchTerminalRecord.Request): void => {
        applyPatch(req.terminalId, req.patch)
    }),
}

export const REGISTRY_ROUTES: readonly RpcRoute[] = [
    removeTerminalFromRegistryRoute,
    patchTerminalRecordRoute,
] as const

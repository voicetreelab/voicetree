// Spawn-family RPC routes (3): spawnPlainTerminal, spawnPlainTerminalWithNode,
// spawnTerminalWithContextNode. The contract keeps these as three distinct
// routes — see design.md §5 — because their request shapes diverge
// (existing-node vs viewport-position vs agent-with-context-node) and only
// the third returns identifiers eagerly while the heavy launch runs
// async.

import {z} from 'zod'

import {terminalRuntimeSurface as agentRuntime} from "@vt/vt-daemon/agent-runtime/agent-control/terminalRuntimeSurface.ts"
import type {
    SpawnPlainTerminal as SpawnPlain,
    SpawnPlainTerminalWithNode as SpawnPlainWithNode,
    SpawnTerminalWithContextNode as SpawnWithContext,
} from '@vt/vt-daemon-protocol'
import type {NodeIdAndFilePath, Position} from '@vt/graph-model/graph'

import {voidRoute, type RpcRoute} from './RpcRoute.ts'
import {buildJsonResponse, type McpToolResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'

const positionShape = z.object({x: z.number(), y: z.number()}).passthrough()

const spawnPlainTerminalRoute: RpcRoute = {
    name: 'spawnPlainTerminal',
    inputShape: {
        nodeId: z.string(),
        terminalCount: z.number(),
    },
    handler: voidRoute<SpawnPlain.Request>(async (req: SpawnPlain.Request): Promise<void> => {
        await agentRuntime.spawnPlainTerminal(req.nodeId as NodeIdAndFilePath, req.terminalCount)
    }),
}

const spawnPlainTerminalWithNodeRoute: RpcRoute = {
    name: 'spawnPlainTerminalWithNode',
    inputShape: {
        position: positionShape,
        terminalCount: z.number(),
    },
    handler: voidRoute<SpawnPlainWithNode.Request>(async (req: SpawnPlainWithNode.Request): Promise<void> => {
        await agentRuntime.spawnPlainTerminalWithNode(req.position as Position, req.terminalCount)
    }),
}

const spawnTerminalWithContextNodeRoute: RpcRoute = {
    name: 'spawnTerminalWithContextNode',
    inputShape: {
        taskNodeId: z.string(),
        agentCommand: z.string().optional(),
        terminalCount: z.number().optional(),
        skipFitAnimation: z.boolean().optional(),
        startUnpinned: z.boolean().optional(),
        selectedNodeIds: z.array(z.string()).optional(),
        spawnDirectory: z.string().optional(),
        parentTerminalId: z.string().optional(),
        promptTemplate: z.string().optional(),
        headless: z.boolean().optional(),
        inheritTerminalId: z.string().optional(),
        envOverrides: z.record(z.string(), z.string()).optional(),
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResponse> => {
        const req: SpawnWithContext.Request = args as unknown as SpawnWithContext.Request
        const result: SpawnWithContext.Response = await agentRuntime.spawnTerminalWithContextNode(
            req.taskNodeId as NodeIdAndFilePath,
            req.agentCommand,
            req.terminalCount,
            req.skipFitAnimation,
            req.startUnpinned,
            req.selectedNodeIds as readonly NodeIdAndFilePath[] | undefined,
            req.spawnDirectory,
            req.parentTerminalId,
            req.promptTemplate,
            req.headless,
            req.inheritTerminalId,
            req.envOverrides,
        )
        return buildJsonResponse(result)
    },
}

export const SPAWN_ROUTES: readonly RpcRoute[] = [
    spawnPlainTerminalRoute,
    spawnPlainTerminalWithNodeRoute,
    spawnTerminalWithContextNodeRoute,
] as const

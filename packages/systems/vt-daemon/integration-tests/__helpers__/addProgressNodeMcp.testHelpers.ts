/**
 * Real-deps fixtures for the create_graph MCP tool integration tests.
 *
 * Replaces the prior vi.mock-based helpers (webapp colocated) with a
 * GraphBridge that drives an in-memory graph + a capturing applyGraphDelta
 * sink, and uses the real agent-runtime terminal-registry as the caller
 * record source. Settings are loaded from a per-test temp app-support
 * directory so caller code paths read live files, not mocks.
 */

import {promises as fs} from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import * as O from 'fp-ts/lib/Option.js'

import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import type {VTSettings} from '@vt/graph-model/settings'
import {DEFAULT_SETTINGS} from '@vt/graph-model/settings'
import {clearSettingsCache} from '@vt/app-config/settings'
import {setAppSupportPath} from '@vt/vt-daemon/state/app-support.ts'
import {
    clearTerminalRecords,
    createTerminalData,
    recordTerminalSpawn,
    type TerminalData,
    type TerminalId,
} from "@vt/vt-daemon"
import {configureMcpServer} from '@vt/vt-daemon'

export type McpToolResponse = {
    content: Array<{type: 'text'; text: string}>
    isError?: boolean
}

export function parsePayload(response: McpToolResponse): unknown {
    return JSON.parse(response.content[0].text)
}

export type SuccessPayload = {
    success: true
    nodes: Array<{id: string; path: string; status: 'ok' | 'warning'; warning?: string}>
}

export type ErrorPayload = {
    success: false
    error: string
}

export const WRITE_FOLDER: string = '/test/vault'
export const READ_PATH: string = '/test/reference-vault'
export const PARENT_NODE_ID: NodeIdAndFilePath = `${WRITE_FOLDER}/parent-task.md` as NodeIdAndFilePath
export const CALLER_TERMINAL_ID: string = 'ctx-nodes/caller.md-terminal-0'
export const CALLER_CONTEXT_NODE_ID: NodeIdAndFilePath = 'ctx-nodes/caller.md' as NodeIdAndFilePath

export function buildGraphNode(nodeId: NodeIdAndFilePath, content: string, options?: {
    position?: {x: number; y: number}
    isContextNode?: boolean
    containedNodeIds?: readonly NodeIdAndFilePath[]
}): GraphNode {
    return {
        absoluteFilePathIsID: nodeId,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: options?.position ? O.some(options.position) : O.none,
            additionalYAMLProps: {},
            isContextNode: options?.isContextNode ?? false,
            containedNodeIds: options?.containedNodeIds,
        },
    }
}

export function buildGraph(extraNodes?: Record<string, GraphNode>): Graph {
    return {
        nodes: {
            [PARENT_NODE_ID]: buildGraphNode(PARENT_NODE_ID, '# Parent Task', {
                position: {x: 100, y: 200},
            }),
            [CALLER_CONTEXT_NODE_ID]: buildGraphNode(CALLER_CONTEXT_NODE_ID, '# Context', {
                isContextNode: true,
                containedNodeIds: ['existing-node.md' as NodeIdAndFilePath],
            }),
            ...extraNodes,
        },
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map([
            ['parent-task', [PARENT_NODE_ID]],
        ]),
        unresolvedLinksIndex: new Map(),
    }
}

/**
 * Live bridge state used by the GraphBridge passed to configureMcpServer.
 * Tests mutate `current` to swap the underlying graph snapshot and read
 * `deltas` to inspect every delta the tool produced.
 */
export type BridgeState = {
    current: Graph
    vaultPaths: readonly string[]
    writeFolder: string | null
    deltas: GraphDelta[]
}

export function createBridgeState(): BridgeState {
    return {
        current: buildGraph(),
        vaultPaths: [WRITE_FOLDER],
        writeFolder: WRITE_FOLDER,
        deltas: [],
    }
}

export function applyDeltaInPlace(graph: Graph, delta: GraphDelta): Graph {
    const nextNodes: Record<string, GraphNode> = {...graph.nodes}
    for (const entry of delta) {
        if (entry.type === 'UpsertNode') {
            nextNodes[entry.nodeToUpsert.absoluteFilePathIsID] = entry.nodeToUpsert
        } else if (entry.type === 'DeleteNode') {
            delete nextNodes[entry.nodeId]
        }
    }
    return {...graph, nodes: nextNodes}
}

export function configureBridge(state: BridgeState): void {
    configureMcpServer({
        graph: {
            getGraph: async () => state.current,
            getVaultPaths: async () => state.vaultPaths,
            getWriteFolder: async () => state.writeFolder,
            getProjectRoot: async () => state.writeFolder,
            getUnseenNodesAroundContextNode: async () => [],
            applyGraphDelta: async (delta: GraphDelta): Promise<void> => {
                state.deltas.push(delta)
                state.current = applyDeltaInPlace(state.current, delta)
            },
        },
    })
}

export function recordCaller(options?: {
    agentName?: string
    color?: string
    attachedToNodeId?: NodeIdAndFilePath
    anchoredToNodeId?: NodeIdAndFilePath
    initialEnvVars?: Record<string, string>
}): void {
    const envVars: Record<string, string> | undefined = options?.color
        ? {AGENT_COLOR: options.color, ...(options.initialEnvVars ?? {})}
        : options?.initialEnvVars
    const data: TerminalData = createTerminalData({
        terminalId: CALLER_TERMINAL_ID as TerminalId,
        attachedToNodeId: (options?.attachedToNodeId ?? CALLER_CONTEXT_NODE_ID),
        anchoredToNodeId: options?.anchoredToNodeId,
        terminalCount: 0,
        title: 'Test Agent',
        executeCommand: true,
        agentName: options?.agentName ?? 'test-agent',
        initialEnvVars: envVars,
    })
    recordTerminalSpawn(CALLER_TERMINAL_ID, data)
}

export async function makeTempAppSupport(): Promise<string> {
    const dir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'vtd-mcp-create-graph-'))
    return dir
}

export async function writeSettings(appSupport: string, settings: VTSettings): Promise<void> {
    await fs.mkdir(appSupport, {recursive: true})
    await fs.writeFile(path.join(appSupport, 'settings.json'), JSON.stringify(settings, null, 2), 'utf-8')
}

/**
 * Standard real-deps setup: temp app-support, settings written, graph
 * bridge wired with the default fixture graph, caller terminal recorded.
 * Returns the bridge state so tests can inspect captured deltas and swap
 * graph snapshots if needed.
 */
export async function setupRealDeps(options?: {
    settings?: Partial<VTSettings>
    extraNodes?: Record<string, GraphNode>
    callerOptions?: Parameters<typeof recordCaller>[0]
}): Promise<{appSupport: string; state: BridgeState}> {
    const appSupport: string = await makeTempAppSupport()
    setAppSupportPath(appSupport)
    clearSettingsCache()
    await writeSettings(appSupport, {
        ...DEFAULT_SETTINGS,
        nodeLineLimit: 70,
        ...(options?.settings ?? {}),
    } as VTSettings)
    clearTerminalRecords()

    const state: BridgeState = createBridgeState()
    if (options?.extraNodes) {
        state.current = buildGraph(options.extraNodes)
    }
    configureBridge(state)
    recordCaller(options?.callerOptions)
    return {appSupport, state}
}

export async function cleanupAppSupport(appSupport: string): Promise<void> {
    await fs.rm(appSupport, {recursive: true, force: true})
}

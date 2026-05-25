import {vi} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/anchoring/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'

import {getVaultPaths, getWriteFolder} from '@vt/graph-db-server/watch-folder/vault-allowlist'
import {getGraph} from '@vt/graph-db-server/state/graph-store'
import {getTerminalRecords} from '@vt/agent-runtime'
import {applyGraphDeltaToDBThroughMemAndUIAndEditors} from '@vt/graph-db-server/graph/applyGraphDelta'

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
export const PARENT_NODE_ID: NodeIdAndFilePath = `${WRITE_FOLDER}/parent-task.md`
export const CALLER_TERMINAL_ID: string = 'ctx-nodes/caller.md-terminal-0'
export const CALLER_CONTEXT_NODE_ID: NodeIdAndFilePath = 'ctx-nodes/caller.md'

export function buildGraphNode(nodeId: NodeIdAndFilePath, content: string, options?: {
    position?: {x: number; y: number}
    isContextNode?: boolean
    containedNodeIds?: readonly string[]
}): GraphNode {
    return {
        kind: 'leaf',
        absoluteFilePathIsID: nodeId,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: options?.position ? O.some(options.position) : O.none,
            additionalYAMLProps: {},
            isContextNode: options?.isContextNode ?? false,
            containedNodeIds: options?.containedNodeIds
        }
    }
}

export function buildGraph(extraNodes?: Record<string, GraphNode>): Graph {
    return {
        nodes: {
            [PARENT_NODE_ID]: buildGraphNode(PARENT_NODE_ID, '# Parent Task', {
                position: {x: 100, y: 200}
            }),
            [CALLER_CONTEXT_NODE_ID]: buildGraphNode(CALLER_CONTEXT_NODE_ID, '# Context', {
                isContextNode: true,
                containedNodeIds: ['existing-node.md']
            }),
            ...extraNodes
        },
        incomingEdgesIndex: new Map(),
        nodeByBaseName: new Map([
            ['parent-task', [PARENT_NODE_ID]]
        ]),
        unresolvedLinksIndex: new Map()
    }
}

export function mockCallerTerminal(options?: {
    agentName?: string
    color?: string
    attachedToNodeId?: string
    anchoredToNodeId?: string
}): void {
    const terminalData: TerminalData = createTerminalData({
        terminalId: CALLER_TERMINAL_ID as TerminalId,
        attachedToNodeId: options?.attachedToNodeId ?? CALLER_CONTEXT_NODE_ID,
        anchoredToNodeId: options?.anchoredToNodeId as NodeIdAndFilePath | undefined,
        terminalCount: 0,
        title: 'Test Agent',
        executeCommand: true,
        agentName: options?.agentName ?? 'test-agent',
        initialEnvVars: options?.color ? {AGENT_COLOR: options.color} : undefined
    })
    vi.mocked(getTerminalRecords).mockReturnValue([
        {terminalId: CALLER_TERMINAL_ID, terminalData, status: 'running', exitCode: null}
    ])
}

export function setupStandardMocks(graphOverride?: Graph): void {
    mockCallerTerminal()
    vi.mocked(getWriteFolder).mockResolvedValue(O.some(WRITE_FOLDER))
    vi.mocked(getVaultPaths).mockResolvedValue([WRITE_FOLDER])
    vi.mocked(getGraph).mockReturnValue(graphOverride ?? buildGraph())
    vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mockResolvedValue(undefined)
}

export function configureCreateGraphServer(): Promise<void> {
    return import('@vt/vt-daemon').then(({configureMcpServer}) => {
        configureMcpServer({
            graph: {
                getGraph: async () => getGraph(),
                getVaultPaths: async () => getVaultPaths(),
                getWriteFolder: async () => O.toNullable(await getWriteFolder()),
                applyGraphDelta: async (delta: GraphDelta, recordForUndo?: boolean) => {
                    await applyGraphDeltaToDBThroughMemAndUIAndEditors(delta, recordForUndo)
                },
            }
        })
    })
}

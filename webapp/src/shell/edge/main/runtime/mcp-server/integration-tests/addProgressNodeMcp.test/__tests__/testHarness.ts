import {vi} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {createTerminalData, type TerminalId} from '@/shell/edge/UI-edge/floating-windows/anchoring/types'
import type {TerminalData} from '@/shell/edge/UI-edge/floating-windows/terminals/terminalDataType'

// Mock shell/edge dependencies
vi.mock('@vt/graph-db-server/watch-folder/vault-allowlist', () => ({
    getWriteFolderPath: vi.fn(),
    getVaultPaths: vi.fn()
}))

vi.mock('@vt/graph-db-server/state/graph-store', () => ({
    getGraph: vi.fn()
}))

vi.mock('@vt/agent-runtime', () => {
    const runtime = {
        closeHeadlessAgent: vi.fn(),
        enqueuePendingMessage: vi.fn(),
        getHeadlessAgentOutput: vi.fn(),
        getIdleSince: vi.fn(),
        getOutput: vi.fn(),
        getPendingTerminal: vi.fn(),
        getRuntimeUI: vi.fn(),
        getTerminalRecords: vi.fn(),
        registerChild: vi.fn(),
        resetAuditRetryCount: vi.fn(),
        runStopHooks: vi.fn(),
        sendTextToTerminal: vi.fn(),
        spawnTerminalWithContextNode: vi.fn(),
        tryConsumeAndSplitBudget: vi.fn(() => ({allowed: true, childBudget: undefined}))
    }
    return {
        ...runtime,
        agentRuntime: runtime,
    }
})

vi.mock('@vt/graph-db-server/graph/applyGraphDelta', () => ({
    applyGraphDeltaToDBThroughMemAndUIAndEditors: vi.fn().mockResolvedValue(undefined),
}))

// Mock settings
vi.mock('@vt/app-config/settings', () => ({
    loadSettings: vi.fn().mockResolvedValue({nodeLineLimit: 70})
}))

// Mock @mermaid-js/parser for mermaid validation tests
vi.mock('@mermaid-js/parser', () => ({
    parse: vi.fn()
}))

import {configureMcpServer, createGraphTool} from '@vt/voicetree-mcp'
import {getVaultPaths} from '@vt/graph-db-server/watch-folder/vault-allowlist'
import {getWriteFolderPath} from '@vt/graph-db-server/watch-folder/vault-allowlist'
import {getGraph} from '@vt/graph-db-server/state/graph-store'
import {getTerminalRecords} from '@vt/agent-runtime'
import {applyGraphDeltaToDBThroughMemAndUIAndEditors} from '@vt/graph-db-server/graph/applyGraphDelta'
import {parse as mermaidParse} from '@mermaid-js/parser'

type McpToolResponse = {
    content: Array<{type: 'text'; text: string}>
    isError?: boolean
}

function parsePayload(response: McpToolResponse): unknown {
    return JSON.parse(response.content[0].text)
}

const WRITE_PATH: string = '/test/vault'
const READ_PATH: string = '/test/reference-vault'
const PARENT_NODE_ID: NodeIdAndFilePath = `${WRITE_PATH}/parent-task.md`
const CALLER_TERMINAL_ID: string = 'ctx-nodes/caller.md-terminal-0'
const CALLER_CONTEXT_NODE_ID: NodeIdAndFilePath = 'ctx-nodes/caller.md'

function buildGraphNode(nodeId: NodeIdAndFilePath, content: string, options?: {
    position?: {x: number; y: number}
    isContextNode?: boolean
    containedNodeIds?: readonly string[]
}): GraphNode {
    return {
        absoluteFilePathIsID: nodeId,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: content,
        nodeUIMetadata: {
            color: O.none,
            position: options?.position ? O.some(options.position) : O.none,
            additionalYAMLProps: new Map(),
            isContextNode: options?.isContextNode ?? false,
            containedNodeIds: options?.containedNodeIds
        }
    }
}

function buildGraph(extraNodes?: Record<string, GraphNode>): Graph {
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

function mockCallerTerminal(options?: {
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

function setupStandardMocks(graphOverride?: Graph): void {
    mockCallerTerminal()
    vi.mocked(getWriteFolderPath).mockResolvedValue(O.some(WRITE_PATH))
    vi.mocked(getVaultPaths).mockResolvedValue([WRITE_PATH])
    vi.mocked(getGraph).mockReturnValue(graphOverride ?? buildGraph())
    vi.mocked(applyGraphDeltaToDBThroughMemAndUIAndEditors).mockResolvedValue(undefined)
}

function configureCreateGraphToolTestServer(): void {
    configureMcpServer({
        graph: {
            getSnapshot: async () => ({
                graph: getGraph(),
                projectRoot: WRITE_PATH,
                vaultPaths: await getVaultPaths(),
                writeFolderPath: O.toNullable(await getWriteFolderPath()),
            }),
            applyGraphDelta: async (delta: GraphDelta, recordForUndo?: boolean) => {
                await applyGraphDeltaToDBThroughMemAndUIAndEditors(delta, recordForUndo)
            },
        }
    })
}

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function createAddProgressNodeMcpTestHarness() {
    return {
        applyGraphDeltaToDBThroughMemAndUIAndEditors,
        buildGraph,
        buildGraphNode,
        CALLER_TERMINAL_ID,
        configureCreateGraphToolTestServer,
        createGraphTool,
        getGraph,
        getTerminalRecords,
        getVaultPaths,
        getWriteFolderPath,
        mermaidParse,
        mockCallerTerminal,
        parsePayload,
        READ_PATH,
        setupStandardMocks,
        WRITE_PATH,
    }
}

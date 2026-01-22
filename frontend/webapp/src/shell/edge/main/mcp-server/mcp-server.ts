/**
 * MCP Server for VoiceTree
 *
 * Exposes graph operations (spawn_agent, list_agents) via Model Context Protocol.
 * This server uses HTTP transport so it can run in-process with Electron and share state.
 *
 * Architecture:
 * - Uses pure functions from @/pure/graph for graph operations
 * - Accesses state via shell functions (getGraph, getVaultPath)
 * - Executes effects via applyGraphDeltaToDBThroughMem
 * - Runs on HTTP transport at localhost:3001/mcp
 */

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {z} from 'zod'
import express, {type Express} from 'express'
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, GraphNode, NodeIdAndFilePath, Position} from '@/pure/graph'
import {getNodeTitle} from '@/pure/graph/markdown-parsing'
import {findBestMatchingNode} from '@/pure/graph/markdown-parsing/extract-edges'
import {createTaskNode} from '@/pure/graph/graph-operations/createTaskNode'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getWritePath} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import {applyGraphDeltaToDBThroughMemAndUIAndEditors} from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange'
import {getUnseenNodesAroundContextNode, type UnseenNode} from '@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode'
import {spawnTerminalWithContextNode} from '@/shell/edge/main/terminals/spawnTerminalWithContextNode'
import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {findAvailablePort} from '@/shell/edge/main/electron/port-utils'

const MCP_BASE_PORT: 3001 = 3001 as const
let mcpPort: number = MCP_BASE_PORT  

type McpToolResponse = {
    content: Array<{type: 'text'; text: string}>
    isError?: boolean
}

function buildJsonResponse(payload: unknown, isError?: boolean): McpToolResponse {
    return {
        content: [{type: 'text', text: JSON.stringify(payload)}],
        isError
    }
}

export interface SpawnAgentParams {
    nodeId?: string
    callerTerminalId: string
    task?: string
    details?: string
    parentNodeId?: string
}

export async function spawnAgentTool({nodeId, callerTerminalId, task, details, parentNodeId}: SpawnAgentParams): Promise<McpToolResponse> {
    console.log(`[MCP] spawn_agent called by terminal: ${callerTerminalId}`)

    // Validate caller terminal exists
    // BUG: Currently fails for valid terminals because renderer's TerminalStore and main's
    // terminal-registry are separate registries that can get out of sync. The planned fix
    // (openspec: consolidate-terminal-registry) makes terminal-registry the single source
    // of truth. If this guard still fails after that change, remove it entirely.
    const terminalRecords: TerminalRecord[] = getTerminalRecords()
    const callerExists: boolean = terminalRecords.some(
        (record: TerminalRecord) => record.terminalId === callerTerminalId
    )
    if (!callerExists) {
        return buildJsonResponse({
            success: false,
            error: `Unknown caller terminal: ${callerTerminalId}`
        }, true)
    }

    const vaultPathOpt: O.Option<string> = await getWritePath()
    if (O.isNone(vaultPathOpt)) {
        return buildJsonResponse({
            success: false,
            error: 'No vault loaded. Please load a folder in the UI first.'
        }, true)
    }
    const writePath: string = vaultPathOpt.value

    const graph: Graph = getGraph()

    // Branch: If task is provided, create a new task node first
    if (task) {
        // Validate parentNodeId is required when task is provided
        if (!parentNodeId) {
            return buildJsonResponse({
                success: false,
                error: 'parentNodeId is required when task is provided'
            }, true)
        }

        // Resolve parent node
        const resolvedParentId: NodeIdAndFilePath | undefined = graph.nodes[parentNodeId]
            ? parentNodeId
            : findBestMatchingNode(parentNodeId, graph.nodes, graph.nodeByBaseName)

        if (!resolvedParentId || !graph.nodes[resolvedParentId]) {
            return buildJsonResponse({
                success: false,
                error: `Parent node ${parentNodeId} not found.`
            }, true)
        }

        const parentNode: GraphNode = graph.nodes[resolvedParentId]

        // Compute position near parent node
        const parentPosition: Position = O.getOrElse(() => ({x: 0, y: 0}))(parentNode.nodeUIMetadata.position)
        const taskNodePosition: Position = {
            x: parentPosition.x + 200,
            y: parentPosition.y + 100
        }

        // Build task description: title with optional details
        const taskDescription: string = details ? `${task}\n\n${details}` : task

        try {
            // Create task node
            const taskNodeDelta: GraphDelta = createTaskNode({
                taskDescription,
                selectedNodeIds: [resolvedParentId],
                graph,
                writePath,
                position: taskNodePosition
            })

            // Extract task node ID from delta
            const taskNodeId: NodeIdAndFilePath = taskNodeDelta[0].type === 'UpsertNode'
                ? taskNodeDelta[0].nodeToUpsert.absoluteFilePathIsID
                : '' as NodeIdAndFilePath

            if (!taskNodeId) {
                return buildJsonResponse({
                    success: false,
                    error: 'Failed to create task node'
                }, true)
            }

            // Apply task node to graph
            await applyGraphDeltaToDBThroughMemAndUIAndEditors(taskNodeDelta)

            // Spawn terminal on the new task node
            const {terminalId, contextNodeId}: {terminalId: string; contextNodeId: string} =
                await spawnTerminalWithContextNode(taskNodeId, undefined, undefined, true, false)

            return buildJsonResponse({
                success: true,
                terminalId,
                taskNodeId,
                contextNodeId,
                message: `Created task node and spawned agent for "${task}"`
            })
        } catch (error) {
            const errorMessage: string = error instanceof Error ? error.message : String(error)
            return buildJsonResponse({
                success: false,
                error: errorMessage
            }, true)
        }
    }

    // Original behavior: spawn on existing node
    if (!nodeId) {
        return buildJsonResponse({
            success: false,
            error: 'Either nodeId or task (with parentNodeId) must be provided'
        }, true)
    }

    // Resolve nodeId: support both full absolute paths and short names (e.g., "fix-test.md")
    // First try direct lookup, then fall back to findBestMatchingNode for short names
    const resolvedNodeId: NodeIdAndFilePath | undefined = graph.nodes[nodeId]
        ? nodeId
        : findBestMatchingNode(nodeId, graph.nodes, graph.nodeByBaseName)

    if (!resolvedNodeId || !graph.nodes[resolvedNodeId]) {
        return buildJsonResponse({
            success: false,
            error: `Node ${nodeId} not found.`
        }, true)
    }

    try {
        // Pass skipFitAnimation: true for MCP spawns to avoid interrupting user's viewport
        const {terminalId, contextNodeId}: {terminalId: string; contextNodeId: string} =
            await spawnTerminalWithContextNode(resolvedNodeId, undefined, undefined, true, false)

        return buildJsonResponse({
            success: true,
            terminalId,
            nodeId: resolvedNodeId,
            contextNodeId,
            message: `Spawned agent for node ${resolvedNodeId}`
        })
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({
            success: false,
            error: errorMessage
        }, true)
    }
}

export async function listAgentsTool(): Promise<McpToolResponse> {
    const graph: Graph = getGraph()
    const agents: Array<{
        terminalId: string
        title: string
        contextNodeId: string
        status: 'running' | 'idle' | 'exited'
        newNodes: Array<{nodeId: string; title: string}>
    }> = []

    const terminalRecords: TerminalRecord[] = getTerminalRecords()
    for (const record of terminalRecords) {
        if (record.terminalData.executeCommand !== true) {
            continue
        }

        const contextNodeId: string = record.terminalData.attachedToNodeId
        let unseenNodes: readonly UnseenNode[] = []

        try {
            unseenNodes = await getUnseenNodesAroundContextNode(contextNodeId)
        } catch (error) {
            console.warn(`[MCP] Failed to fetch unseen nodes for ${contextNodeId}:`, error)
        }

        const newNodes: Array<{nodeId: string; title: string}> = unseenNodes.map((node: UnseenNode) => {
            const graphNode: GraphNode | undefined = graph.nodes[node.nodeId]
            return {
                nodeId: node.nodeId,
                title: graphNode ? getNodeTitle(graphNode) : node.nodeId
            }
        })

        // Determine status: exited > idle (isDone) > running
        // isDone reflects UI green indicator (no output for a period)
        const status: 'running' | 'idle' | 'exited' = record.status === 'exited'
            ? 'exited'
            : record.terminalData.isDone
                ? 'idle'
                : 'running'

        agents.push({
            terminalId: record.terminalId,
            title: record.terminalData.title,
            contextNodeId,
            status,
            newNodes
        })
    }

    return buildJsonResponse({agents})
}

export async function waitForAgentsTool({
    terminalIds,
    callerTerminalId,
    pollIntervalMs = 5000,
    timeoutMs = 1200000 // 20 minute default
}: {
    terminalIds: string[]
    callerTerminalId: string
    pollIntervalMs?: number
    timeoutMs?: number
}): Promise<McpToolResponse> {
    // 1. Validate caller terminal exists
    const records: TerminalRecord[] = getTerminalRecords()
    if (!records.some((r: TerminalRecord) => r.terminalId === callerTerminalId)) {
        return buildJsonResponse({success: false, error: `Unknown caller: ${callerTerminalId}`}, true)
    }

    // 2. Validate all target terminals exist
    for (const tid of terminalIds) {
        if (!records.some((r: TerminalRecord) => r.terminalId === tid)) {
            return buildJsonResponse({success: false, error: `Unknown terminal: ${tid}`}, true)
        }
    }

    // 3. Poll until all are exited or timeout reached
    const startTime: number = Date.now()
    while (Date.now() - startTime < timeoutMs) {
        const currentRecords: TerminalRecord[] = getTerminalRecords()
        const targetRecords: TerminalRecord[] = currentRecords.filter(
            (r: TerminalRecord) => terminalIds.includes(r.terminalId)
        )
        const allExited: boolean = targetRecords.every((r: TerminalRecord) => r.status === 'exited')

        if (allExited) {
            return buildJsonResponse({
                success: true,
                agents: targetRecords.map((r: TerminalRecord) => ({
                    terminalId: r.terminalId,
                    title: r.terminalData.title,
                    status: 'exited'
                }))
            })
        }

        await new Promise(resolve => setTimeout(resolve, pollIntervalMs))
    }

    // Timeout reached - return partial results
    const finalRecords: TerminalRecord[] = getTerminalRecords()
    const targetRecords: TerminalRecord[] = finalRecords.filter(
        (r: TerminalRecord) => terminalIds.includes(r.terminalId)
    )
    const stillRunning: string[] = targetRecords
        .filter((r: TerminalRecord) => r.status !== 'exited')
        .map((r: TerminalRecord) => r.terminalId)

    return buildJsonResponse({
        success: false,
        error: `Timeout waiting for agents after ${timeoutMs}ms`,
        stillRunning,
        agents: targetRecords.map((r: TerminalRecord) => ({
            terminalId: r.terminalId,
            title: r.terminalData.title,
            status: r.status
        }))
    }, true)
}

/**
 * Creates and configures the MCP server with VoiceTree tools.
 */
export function createMcpServer(): McpServer {
    const server: McpServer = new McpServer({
        name: 'voicetree-mcp',
        version: '1.0.0'
    })

    // Tool: add_node - COMMENTED OUT
    // server.registerTool(
    //     'add_node',
    //     {
    //         title: 'Add Node',
    //         description: 'Add a new node to the graph. Creates a markdown file and updates the graph with bidirectional edge healing.',
    //         inputSchema: {
    //             nodeId: z.string().describe('Relative path/ID for the node (e.g., "my_node" or "subfolder/my_node")'),
    //             content: z.string().describe('Markdown content for the node'),
    //             parentNodeId: z.string().optional().describe('Optional parent node ID to create a link to')
    //         }
    //     },
    //     async ({nodeId, content, parentNodeId}) => {
    //         // Get default write path (where new nodes are created)
    //         const vaultPathOpt: O.Option<string> = await getWritePath()
    //         if (O.isNone(vaultPathOpt)) {
    //             return {
    //                 content: [{
    //                     type: 'text',
    //                     text: JSON.stringify({
    //                         success: false,
    //                         nodeId,
    //                         message: 'No vault loaded. Please load a folder in the UI first.'
    //                     })
    //                 }],
    //                 isError: true
    //             }
    //         }
    //         const vaultPath: string = vaultPathOpt.value
    //
    //         // Get watched directory (base for node ID computation)
    //         const watchedDirectory: string | null = getWatchedDirectory()
    //         if (!watchedDirectory) {
    //             return {
    //                 content: [{
    //                     type: 'text',
    //                     text: JSON.stringify({
    //                         success: false,
    //                         nodeId,
    //                         message: 'Watched directory not set.'
    //                     })
    //                 }],
    //                 isError: true
    //             }
    //         }
    //
    //         // Build markdown content with optional parent link
    //         let markdownContent: string = content
    //         if (parentNodeId) {
    //             markdownContent = `${content}\n\n-----------------\n_Links:_\nParent:\n- child_of [[${parentNodeId}]]\n`
    //         }
    //
    //         // Create FSUpdate event - absolutePath uses vaultPath
    //         const absolutePath: string = path.join(vaultPath, `${nodeId}.md`)
    //         const fsEvent: FSUpdate = {
    //             absolutePath,
    //             content: markdownContent,
    //             eventType: 'Added'
    //         }
    //
    //         // Apply to graph using pure function - pass watchedDirectory for node ID computation
    //         // Node IDs must be relative to watchedDirectory so paths reconstruct correctly
    //         const currentGraph: Graph = getGraph()
    //         const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, currentGraph)
    //
    //         // Persist to filesystem
    //         await applyGraphDeltaToDBThroughMemAndUIAndEditors(delta)
    //
    //         return {
    //             content: [{
    //                 type: 'text',
    //                 text: JSON.stringify({
    //                     success: true,
    //                     nodeId,
    //                     message: `Node created at ${absolutePath}`
    //                 })
    //             }]
    //         }
    //     }
    // )

    // Tool: get_graph - COMMENTED OUT (unnecessary, agents can just read the markdown folders directly)
    // server.registerTool(
    //     'get_graph',
    //     {
    //         title: 'Get Graph',
    //         description: 'Get the current graph state with all nodes and edges.',
    //         inputSchema: {}
    //     },
    //     async () => {
    //         const graph: Graph = getGraph()
    //         const nodes: Record<string, {
    //             id: string
    //             title: string
    //             content: string
    //             outgoingEdges: Array<{targetId: string; label: string}>
    //         }> = {}
    //
    //         for (const [_nodeId, node] of Object.entries(graph.nodes)) {
    //             nodes[node.absoluteFilePathIsID] = {
    //                 id: node.absoluteFilePathIsID,
    //                 title: getNodeTitle(node),
    //                 content: node.contentWithoutYamlOrLinks,
    //                 outgoingEdges: node.outgoingEdges.map(e => ({
    //                     targetId: e.targetId,
    //                     label: e.label
    //                 }))
    //             }
    //         }
    //
    //         return {
    //             content: [{
    //                 type: 'text',
    //                 text: JSON.stringify({
    //                     nodeCount: Object.keys(nodes).length,
    //                     nodes
    //                 }, null, 2)
    //             }]
    //         }
    //     }
    // )

    // Tool: spawn_agent
    server.registerTool(
        'spawn_agent',
        {
            title: 'Spawn Agent',
            description: 'Spawn an agent in the VoiceTree graph to perform a task. Prefer this over your Task or subagent tool for tasks involving code modifications where the user would benefit from visibility and control over the changes. If you already have a node detailing the task, use nodeId. Otherwise, use task+parentNodeId to create a new task node first.',
            inputSchema: {
                nodeId: z.string().optional().describe('Target node ID to attach the spawned agent (use this OR task+parentNodeId)'),
                callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
                task: z.string().optional().describe('Task title for creating a new task node (requires parentNodeId)'),
                details: z.string().optional().describe('Detailed description of the task (used with task parameter)'),
                parentNodeId: z.string().optional().describe('Parent node ID under which to create the new task node (required when task is provided)')
            }
        },
        async ({nodeId, callerTerminalId, task, details, parentNodeId}) => spawnAgentTool({nodeId, callerTerminalId, task, details, parentNodeId})
    )

    // Tool: list_agents
    server.registerTool(
        'list_agents',
        {
            title: 'List Agents',
            description: 'List running agent terminals with their status and newly created nodes.',
            inputSchema: {}
        },
        listAgentsTool
    )

    // Tool: wait_for_agents
    server.registerTool(
        'wait_for_agents',
        {
            title: 'Wait for Agents',
            description: 'Wait for specified agent terminals to complete. Returns when all agents have exited.',
            inputSchema: {
                terminalIds: z.array(z.string()).describe('Array of terminal IDs to wait for'),
                callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
                pollIntervalMs: z.number().optional().describe('Poll interval in ms (default: 5000)'),
                timeoutMs: z.number().optional().describe('Max wait time in ms (default: 1200000)')
            }
        },
        async ({terminalIds, callerTerminalId, pollIntervalMs, timeoutMs}) =>
            waitForAgentsTool({terminalIds, callerTerminalId, pollIntervalMs, timeoutMs})
    )

    return server
}

/**
 * Starts the MCP server with HTTP transport.
 * This allows the server to run in-process with Electron and share state.
 */
export async function startMcpServer(): Promise<void> {
    const mcpServer: McpServer = createMcpServer()

    const app: Express = express()
    app.use(express.json())

    app.post('/mcp', async (req, res) => {
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true
        })

        res.on('close', () => {
            void transport.close()
        })

        await mcpServer.connect(transport)
        await transport.handleRequest(req, res, req.body)
    })

    mcpPort = await findAvailablePort(MCP_BASE_PORT)

    app.listen(mcpPort, '127.0.0.1', () => {
        console.log(`[MCP] VoiceTree MCP Server running on http://localhost:${mcpPort}/mcp`)
    })
}

/**
 * Returns the MCP server port for configuration.
 */
export function getMcpPort(): number {
    return mcpPort
}

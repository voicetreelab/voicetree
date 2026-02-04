/**
 * MCP Server for Voicetree
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
import {askQuery, type SearchSimilarResult} from '@/shell/edge/main/backend-api'
import {spawnTerminalWithContextNode} from '@/shell/edge/main/terminals/spawnTerminalWithContextNode'
import {getTerminalRecords, type TerminalRecord} from '@/shell/edge/main/terminals/terminal-registry'
import {findAvailablePort} from '@/shell/edge/main/electron/port-utils'
import {getTerminalManager} from '@/shell/edge/main/terminals/terminal-manager-instance'
import {getOutput} from '@/shell/edge/main/terminals/terminal-output-buffer'

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
    spawnDirectory?: string
}

export async function spawnAgentTool({nodeId, callerTerminalId, task, details, parentNodeId, spawnDirectory}: SpawnAgentParams): Promise<McpToolResponse> {
    //console.log(`[MCP] spawn_agent called by terminal: ${callerTerminalId}`)

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

            // Spawn terminal on the new task node (with parent terminal for tree-style tabs)
            const {terminalId, contextNodeId}: {terminalId: string; contextNodeId: string} =
                await spawnTerminalWithContextNode(taskNodeId, undefined, undefined, true, false, undefined, spawnDirectory, callerTerminalId)

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
        // Pass callerTerminalId as parentTerminalId for tree-style tabs
        const {terminalId, contextNodeId}: {terminalId: string; contextNodeId: string} =
            await spawnTerminalWithContextNode(resolvedNodeId, undefined, undefined, true, false, undefined, spawnDirectory, callerTerminalId)

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
        const agentName: string | undefined = record.terminalData.agentName

        // Find nodes created by this agent via agent_name matching
        // This uses the same mechanism as the blue dotted edges in applyGraphDeltaToUI
        const newNodes: Array<{nodeId: string; title: string}> = []
        if (agentName) {
            for (const node of Object.values(graph.nodes)) {
                const nodeAgentName: string | undefined = node.nodeUIMetadata.additionalYAMLProps.get('agent_name')
                if (nodeAgentName === agentName) {
                    newNodes.push({
                        nodeId: node.absoluteFilePathIsID,
                        title: getNodeTitle(node)
                    })
                }
            }
        }

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

    // Helper to determine agent status: exited > idle (isDone) > running
    const getAgentStatus = (r: TerminalRecord): 'running' | 'idle' | 'exited' =>
        r.status === 'exited' ? 'exited' : r.terminalData.isDone ? 'idle' : 'running'

    // 3. Poll until all are idle or exited, or timeout reached
    const startTime: number = Date.now()
    while (Date.now() - startTime < timeoutMs) {
        const currentRecords: TerminalRecord[] = getTerminalRecords()
        const targetRecords: TerminalRecord[] = currentRecords.filter(
            (r: TerminalRecord) => terminalIds.includes(r.terminalId)
        )
        const allDone: boolean = targetRecords.every(
            (r: TerminalRecord) => getAgentStatus(r) !== 'running'
        )

        if (allDone) {
            return buildJsonResponse({
                success: true,
                agents: targetRecords.map((r: TerminalRecord) => ({
                    terminalId: r.terminalId,
                    title: r.terminalData.title,
                    status: getAgentStatus(r)
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
        .filter((r: TerminalRecord) => getAgentStatus(r) === 'running')
        .map((r: TerminalRecord) => r.terminalId)

    return buildJsonResponse({
        success: false,
        error: `Timeout waiting for agents after ${timeoutMs}ms`,
        stillRunning,
        agents: targetRecords.map((r: TerminalRecord) => ({
            terminalId: r.terminalId,
            title: r.terminalData.title,
            status: getAgentStatus(r)
        }))
    }, true)
}

export async function getUnseenNodesNearbyTool({
    callerTerminalId,
    search_from_node
}: {
    callerTerminalId: string
    search_from_node?: string
}): Promise<McpToolResponse> {
    // 1. Find the caller's terminal record
    const terminalRecords: TerminalRecord[] = getTerminalRecords()
    const callerRecord: TerminalRecord | undefined = terminalRecords.find(
        (r: TerminalRecord) => r.terminalId === callerTerminalId
    )

    if (!callerRecord) {
        return buildJsonResponse({
            success: false,
            error: `Unknown caller terminal: ${callerTerminalId}`
        }, true)
    }

    // 2. Get the context node from the terminal
    const contextNodeId: string = callerRecord.terminalData.attachedToNodeId

    // 3. Get unseen nodes (with optional search_from_node override)
    const graph: Graph = getGraph()
    try {
        const unseenNodes: readonly UnseenNode[] = await getUnseenNodesAroundContextNode(
            contextNodeId,
            search_from_node as NodeIdAndFilePath | undefined
        )

        const nodes: Array<{nodeId: string; title: string; content: string}> = unseenNodes.map((node: UnseenNode) => {
            const graphNode: GraphNode | undefined = graph.nodes[node.nodeId]
            return {
                nodeId: node.nodeId,
                title: graphNode ? getNodeTitle(graphNode) : node.nodeId,
                content: node.content
            }
        })

        return buildJsonResponse({
            success: true,
            contextNodeId,
            unseenNodes: nodes
        })
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({
            success: false,
            error: errorMessage
        }, true)
    }
}

export async function sendMessageTool({
    terminalId,
    message,
    callerTerminalId
}: {
    terminalId: string
    message: string
    callerTerminalId: string
}): Promise<McpToolResponse> {
    // 1. Validate caller terminal exists
    const terminalRecords: TerminalRecord[] = getTerminalRecords()
    if (!terminalRecords.some((r: TerminalRecord) => r.terminalId === callerTerminalId)) {
        return buildJsonResponse({
            success: false,
            error: `Unknown caller terminal: ${callerTerminalId}`
        }, true)
    }

    // 2. Find the target terminal
    const targetRecord: TerminalRecord | undefined = terminalRecords.find(
        (r: TerminalRecord) => r.terminalId === terminalId
    )

    if (!targetRecord) {
        return buildJsonResponse({
            success: false,
            error: `Terminal not found: ${terminalId}`
        }, true)
    }

    // 3. Write message to terminal (with carriage return to execute)
    try {
        const terminalManager = getTerminalManager()
        const result = terminalManager.write(terminalId, message + '\r')

        if (!result.success) {
            return buildJsonResponse({
                success: false,
                error: result.error ?? 'Failed to send message'
            }, true)
        }

        return buildJsonResponse({
            success: true,
            terminalId,
            message: `Successfully sent message to terminal: ${terminalId}`
        })
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({
            success: false,
            error: errorMessage
        }, true)
    }
}

export async function closeAgentTool({
    terminalId,
    callerTerminalId
}: {
    terminalId: string
    callerTerminalId: string
}): Promise<McpToolResponse> {
    // 1. Validate caller terminal exists
    const terminalRecords: TerminalRecord[] = getTerminalRecords()
    if (!terminalRecords.some((r: TerminalRecord) => r.terminalId === callerTerminalId)) {
        return buildJsonResponse({
            success: false,
            error: `Unknown caller terminal: ${callerTerminalId}`
        }, true)
    }

    // 2. Find the target terminal
    const targetRecord: TerminalRecord | undefined = terminalRecords.find(
        (r: TerminalRecord) => r.terminalId === terminalId
    )

    if (!targetRecord) {
        return buildJsonResponse({
            success: false,
            error: `Terminal not found: ${terminalId}`
        }, true)
    }

    // 3. Kill the terminal using the terminal manager
    try {
        const terminalManager = getTerminalManager()
        const result = terminalManager.kill(terminalId)

        if (!result.success) {
            return buildJsonResponse({
                success: false,
                error: result.error ?? 'Failed to close terminal'
            }, true)
        }

        return buildJsonResponse({
            success: true,
            terminalId,
            message: `Successfully closed agent terminal: ${terminalId}`
        })
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({
            success: false,
            error: errorMessage
        }, true)
    }
}

export async function readTerminalOutputTool({
    terminalId,
    callerTerminalId,
    nLines = 100
}: {
    terminalId: string
    callerTerminalId: string
    nLines?: number
}): Promise<McpToolResponse> {
    // 1. Validate caller terminal exists
    const terminalRecords: TerminalRecord[] = getTerminalRecords()
    if (!terminalRecords.some((r: TerminalRecord) => r.terminalId === callerTerminalId)) {
        return buildJsonResponse({
            success: false,
            error: `Unknown caller terminal: ${callerTerminalId}`
        }, true)
    }

    // 2. Find the target terminal
    const targetRecord: TerminalRecord | undefined = terminalRecords.find(
        (r: TerminalRecord) => r.terminalId === terminalId
    )

    if (!targetRecord) {
        return buildJsonResponse({
            success: false,
            error: `Terminal not found: ${terminalId}`
        }, true)
    }

    // 3. Get output from buffer module
    const output = getOutput(terminalId, nLines)

    if (output === undefined) {
        return buildJsonResponse({
            success: false,
            error: `No output buffer for terminal: ${terminalId}`
        }, true)
    }

    return buildJsonResponse({
        success: true,
        terminalId,
        nLines,
        output
    })
}

export async function searchNodesTool({
    query,
    top_k = 10
}: {
    query: string
    top_k?: number
}): Promise<McpToolResponse> {
    if (!query || query.trim() === '') {
        return buildJsonResponse({
            success: false,
            error: 'Query cannot be empty'
        }, true)
    }

    try {
        const response = await askQuery(query, top_k)
        const results: Array<{node_path: string; title: string; score: number}> = response.relevant_nodes.map(
            (node: SearchSimilarResult) => ({
                node_path: node.node_path,
                title: node.title,
                score: node.score
            })
        )

        return buildJsonResponse({
            success: true,
            query,
            results
        })
    } catch (error) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return buildJsonResponse({
            success: false,
            error: `Backend unavailable or search failed: ${errorMessage}`
        }, true)
    }
}

/**
 * Creates and configures the MCP server with Voicetree tools.
 */
export function createMcpServer(): McpServer {
    const server: McpServer = new McpServer({
        name: 'voicetree-mcp',
        version: '1.0.0'
    })

    // Tool: spawn_agent
    server.registerTool(
        'spawn_agent',
        {
            title: 'Spawn Agent',
            description: `Spawn an agent in the Voicetree graph. Prefer this over built-in subagents—users get visibility and control over the work.

**When to use:** Complex tasks, parallelizable subtasks, any work where user visibility matters.

**Pattern:** Decompose into nodes → spawn agents → wait_for_agents → review with get_unseen_nodes_nearby.

If you already have a node detailing the task, use nodeId. Otherwise, use task+parentNodeId to create a new task node first.`,
            inputSchema: {
                nodeId: z.string().optional().describe('Target node ID to attach the spawned agent (use this OR task+parentNodeId)'),
                callerTerminalId: z.string().describe('Your terminal ID, you must echo $VOICETREE_TERMINAL_ID to retrieve it if you have not yet.'),
                task: z.string().optional().describe('Task title for creating a new task node (requires parentNodeId)'),
                details: z.string().optional().describe('Detailed description of the task (used with task parameter)'),
                parentNodeId: z.string().optional().describe('Parent node ID under which to create the new task node (required when task is provided)'),
                spawnDirectory: z.string().optional().describe('Absolute path to spawn the agent in. Use this to spawn subagents in the same worktree as the parent (pass your current working directory).')
            }
        },
        async ({nodeId, callerTerminalId, task, details, parentNodeId, spawnDirectory}) => spawnAgentTool({nodeId, callerTerminalId, task, details, parentNodeId, spawnDirectory})
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

    // Tool: get_unseen_nodes_nearby
    server.registerTool(
        'get_unseen_nodes_nearby',
        {
            title: 'Get Unseen Nodes Nearby',
            description: 'Get nodes near your context that were created after your context was generated. The user or other agents may have added nodes for you to read. Call this to check for new relevant information.',
            inputSchema: {
                callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
                search_from_node: z.string().optional().describe('Optional node ID to search from instead of your task node')
            }
        },
        async ({callerTerminalId, search_from_node}) =>
            getUnseenNodesNearbyTool({callerTerminalId, search_from_node})
    )

    // Tool: close_agent
    server.registerTool(
        'close_agent',
        {
            title: 'Close Agent',
            description: 'Close an agent terminal. After waiting for an agent to finish, review its work. Close the agent if satisfied with its output. Leave the agent open if any tech debt was introduced or if human review would be beneficial - open terminals signal to the user that attention is needed.',
            inputSchema: {
                terminalId: z.string().describe('The terminal ID of the agent to close'),
                callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var')
            }
        },
        async ({terminalId, callerTerminalId}) =>
            closeAgentTool({terminalId, callerTerminalId})
    )

    // Tool: send_message
    server.registerTool(
        'send_message',
        {
            title: 'Send Message to Agent',
            description: 'Send a message directly to an agent terminal. The message is injected into the terminal and executed (carriage return appended). Use this to provide follow-up instructions, answer prompts, or inject commands into a running agent.',
            inputSchema: {
                terminalId: z.string().describe('The terminal ID of the agent to send the message to'),
                message: z.string().describe('The message/command to send to the terminal'),
                callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var')
            }
        },
        async ({terminalId, message, callerTerminalId}) =>
            sendMessageTool({terminalId, message, callerTerminalId})
    )

    // Tool: read_terminal_output
    server.registerTool(
        'read_terminal_output',
        {
            title: 'Read Terminal Output',
            description: 'Read the last N lines of output from an agent terminal. Output has ANSI escape codes stripped for readability. Use this to check what an agent has printed, debug issues, or verify agent progress without waiting for completion.',
            inputSchema: {
                terminalId: z.string().describe('The terminal ID of the agent to read output from'),
                callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
                nLines: z.number().optional().describe('Number of lines to return (default: 100)')
            }
        },
        async ({terminalId, callerTerminalId, nLines}) =>
            readTerminalOutputTool({terminalId, callerTerminalId, nLines})
    )

    // Tool: search_nodes
    server.registerTool(
        'search_nodes',
        {
            title: 'Search Nodes',
            description: 'Search for semantically relevant nodes in the graph using hybrid vector + BM25 search. Use this to find related context, prior work, or relevant documentation within the markdown tree.',
            inputSchema: {
                query: z.string().describe('The search query text'),
                top_k: z.number().optional().describe('Number of results to return (default: 10)')
            }
        },
        async ({query, top_k}) => searchNodesTool({query, top_k})
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
        //console.log(`[MCP] Voicetree MCP Server running on http://localhost:${mcpPort}/mcp`)
    })
}

/**
 * Returns the MCP server port for configuration.
 */
export function getMcpPort(): number {
    return mcpPort
}

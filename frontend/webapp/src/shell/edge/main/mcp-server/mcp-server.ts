/**
 * MCP Server for VoiceTree
 *
 * Exposes graph operations (add_node, get_graph, list_nodes) via Model Context Protocol.
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
import path from 'path'

import type {FSUpdate, Graph, GraphDelta} from '@/pure/graph'
import {addNodeToGraphWithEdgeHealingFromFSEvent} from '@/pure/graph/graphDelta/addNodeToGraphWithEdgeHealingFromFSEvent'
import {getNodeTitle} from '@/pure/graph/markdown-parsing'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getDefaultWritePath, setVaultPath, getWatchedDirectory} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import {getUnseenNodesAroundContextNode, type UnseenNode} from '@/shell/edge/main/graph/context-nodes/getUnseenNodesAroundContextNode'
import {
    applyGraphDeltaToDBThroughMemAndUIAndEditors
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange";

const MCP_PORT: 3001 = 3001 as const

/**
 * Creates and configures the MCP server with VoiceTree tools.
 */
export function createMcpServer(): McpServer {
    const server: McpServer = new McpServer({
        name: 'voicetree-mcp',
        version: '1.0.0'
    })

    // Tool: set_vault_path
    server.registerTool(
        'set_vault_path',
        {
            title: 'Set Vault Path',
            description: 'Set the vault path for this MCP session. Must be called before add_node.',
            inputSchema: {
                vaultPath: z.string().describe('Absolute path to the vault directory')
            }
        },
        async ({vaultPath}) => {
            setVaultPath(vaultPath)
            return {
                content: [{type: 'text', text: JSON.stringify({success: true, vaultPath})}]
            }
        }
    )

    // Tool: add_node
    server.registerTool(
        'add_node',
        {
            title: 'Add Node',
            description: 'Add a new node to the graph. Creates a markdown file and updates the graph with bidirectional edge healing.',
            inputSchema: {
                nodeId: z.string().describe('Relative path/ID for the node (e.g., "my_node" or "subfolder/my_node")'),
                content: z.string().describe('Markdown content for the node'),
                parentNodeId: z.string().optional().describe('Optional parent node ID to create a link to')
            }
        },
        async ({nodeId, content, parentNodeId}) => {
            // Get default write path (where new nodes are created)
            const vaultPathOpt: O.Option<string> = getDefaultWritePath()
            if (O.isNone(vaultPathOpt)) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            nodeId,
                            message: 'Vault path not set. Call set_vault_path first.'
                        })
                    }],
                    isError: true
                }
            }
            const vaultPath: string = vaultPathOpt.value

            // Get watched directory (base for node ID computation)
            const watchedDirectory: string | null = getWatchedDirectory()
            if (!watchedDirectory) {
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            nodeId,
                            message: 'Watched directory not set.'
                        })
                    }],
                    isError: true
                }
            }

            // Build markdown content with optional parent link
            let markdownContent: string = content
            if (parentNodeId) {
                markdownContent = `${content}\n\n-----------------\n_Links:_\nParent:\n- child_of [[${parentNodeId}]]\n`
            }

            // Create FSUpdate event - absolutePath uses vaultPath
            const absolutePath: string = path.join(vaultPath, `${nodeId}.md`)
            const fsEvent: FSUpdate = {
                absolutePath,
                content: markdownContent,
                eventType: 'Added'
            }

            // Apply to graph using pure function - pass watchedDirectory for node ID computation
            // Node IDs must be relative to watchedDirectory so paths reconstruct correctly
            const currentGraph: Graph = getGraph()
            const delta: GraphDelta = addNodeToGraphWithEdgeHealingFromFSEvent(fsEvent, watchedDirectory, currentGraph)

            // Persist to filesystem
            await applyGraphDeltaToDBThroughMemAndUIAndEditors(delta)

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        success: true,
                        nodeId,
                        message: `Node created at ${absolutePath}`
                    })
                }]
            }
        }
    )

    // Tool: get_graph
    server.registerTool(
        'get_graph',
        {
            title: 'Get Graph',
            description: 'Get the current graph state with all nodes and edges.',
            inputSchema: {}
        },
        async () => {
            const graph: Graph = getGraph()
            const nodes: Record<string, {
                id: string
                title: string
                content: string
                outgoingEdges: Array<{targetId: string; label: string}>
            }> = {}

            for (const [_nodeId, node] of Object.entries(graph.nodes)) {
                nodes[node.relativeFilePathIsID] = {
                    id: node.relativeFilePathIsID,
                    title: getNodeTitle(node),
                    content: node.contentWithoutYamlOrLinks,
                    outgoingEdges: node.outgoingEdges.map(e => ({
                        targetId: e.targetId,
                        label: e.label
                    }))
                }
            }

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({
                        nodeCount: Object.keys(nodes).length,
                        nodes
                    }, null, 2)
                }]
            }
        }
    )

    // Tool: list_nodes
    server.registerTool(
        'list_nodes',
        {
            title: 'List Nodes',
            description: 'List all nodes in the graph with their IDs and titles.',
            inputSchema: {}
        },
        async () => {
            const graph: Graph = getGraph()
            const nodes: { id: string; title: string; }[] = Object.values(graph.nodes).map(node => ({
                id: node.relativeFilePathIsID,
                title: getNodeTitle(node)
            }))

            return {
                content: [{
                    type: 'text',
                    text: JSON.stringify({nodes}, null, 2)
                }]
            }
        }
    )

    // Tool: get_unseen_nodes_around_context_node
    server.registerTool(
        'get_unseen_nodes_around_context_node',
        {
            title: 'Get Unseen Nodes Around Context Node',
            description: 'For a given context node, re-runs the graph traversal and returns nodes that were not included in the original context. Returns content without YAML frontmatter.',
            inputSchema: {
                contextNodeId: z.string().describe('The ID of the context node to find unseen nodes around')
            }
        },
        async ({contextNodeId}) => {
            try {
                const unseenNodes: readonly UnseenNode[] = await getUnseenNodesAroundContextNode(contextNodeId)

                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: true,
                            contextNodeId,
                            unseenNodeCount: unseenNodes.length,
                            unseenNodes: unseenNodes.map(node => ({
                                nodeId: node.nodeId,
                                content: node.content
                            }))
                        }, null, 2)
                    }]
                }
            } catch (error) {
                const errorMessage: string = error instanceof Error ? error.message : String(error)
                return {
                    content: [{
                        type: 'text',
                        text: JSON.stringify({
                            success: false,
                            contextNodeId,
                            error: errorMessage
                        })
                    }],
                    isError: true
                }
            }
        }
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

    app.listen(MCP_PORT, () => {
        console.log(`[MCP] VoiceTree MCP Server running on http://localhost:${MCP_PORT}/mcp`)
    })
}

/**
 * Returns the MCP server port for configuration.
 */
export function getMcpPort(): number {
    return MCP_PORT
}

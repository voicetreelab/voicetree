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
import {findAvailablePort} from '@/shell/edge/main/electron/port-utils'

// Import tool implementations
import {spawnAgentTool} from './spawnAgentTool'
import {listAgentsTool} from './listAgentsTool'
import {waitForAgentsTool} from './waitForAgentsTool'
import {getUnseenNodesNearbyTool} from './getUnseenNodesNearbyTool'
import {sendMessageTool} from './sendMessageTool'
import {closeAgentTool} from './closeAgentTool'
import {readTerminalOutputTool} from './readTerminalOutputTool'
import {searchNodesTool} from './searchNodesTool'
import {createGraphTool} from './createGraphTool'

// Re-export types and tool functions for external use
export type {McpToolResponse} from './types'
export {buildJsonResponse} from './types'
export type {SpawnAgentParams} from './spawnAgentTool'
export {spawnAgentTool} from './spawnAgentTool'
export {listAgentsTool} from './listAgentsTool'
export type {WaitForAgentsParams} from './waitForAgentsTool'
export {waitForAgentsTool} from './waitForAgentsTool'
export type {GetUnseenNodesNearbyParams} from './getUnseenNodesNearbyTool'
export {getUnseenNodesNearbyTool} from './getUnseenNodesNearbyTool'
export type {SendMessageParams} from './sendMessageTool'
export {sendMessageTool} from './sendMessageTool'
export type {CloseAgentParams} from './closeAgentTool'
export {closeAgentTool} from './closeAgentTool'
export type {ReadTerminalOutputParams} from './readTerminalOutputTool'
export {readTerminalOutputTool} from './readTerminalOutputTool'
export type {SearchNodesParams} from './searchNodesTool'
export {searchNodesTool} from './searchNodesTool'
export type {CreateGraphParams, CreateGraphNodeInput} from './createGraphTool'
export {createGraphTool} from './createGraphTool'

const MCP_BASE_PORT: 3001 = 3001 as const
let mcpPort: number = MCP_BASE_PORT

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
                spawnDirectory: z.string().optional().describe('Absolute path to spawn the agent in. By default, inherits the parent terminal\'s directory (worktree-safe). Only needed to override, for example to contain child-agent to a subfolder')
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
            description: 'Wait for specified agent terminals to complete. Returns immediately with a monitorId. The monitor polls in the background and sends a completion message to your terminal when all agents are done.\n\nIMPORTANT: This tool is non-blocking. After calling it, you should continue with other work or inform the user you are waiting. Do NOT manually poll agent status — a "[WaitForAgents] All agents completed." message will be automatically injected into your terminal when all agents finish their work. You will see this message appear as if the user sent it.',
            inputSchema: {
                terminalIds: z.array(z.string()).describe('Array of terminal IDs to wait for'),
                callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
                pollIntervalMs: z.number().optional().describe('Poll interval in ms (default: 5000)')
            }
        },
        ({terminalIds, callerTerminalId, pollIntervalMs}) =>
            waitForAgentsTool({terminalIds, callerTerminalId, pollIntervalMs})
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
            description: 'Read the last N characters of output from an agent terminal. Output has ANSI escape codes stripped for readability. Use this to check what an agent has printed, debug issues, or verify agent progress without waiting for completion.',
            inputSchema: {
                terminalId: z.string().describe('The terminal ID of the agent to read output from'),
                callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
                nChars: z.number().optional().describe('Number of characters to return (default: 10000)')
            }
        },
        async ({terminalId, callerTerminalId, nChars}) =>
            readTerminalOutputTool({terminalId, callerTerminalId, nChars})
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

    // Tool: create_graph
    server.registerTool(
        'create_graph',
        {
            title: 'Create Graph',
            description: `Create a graph of progress nodes in a single call. Supports trees, chains, fan-out, fan-in, and diamond dependencies (multiple parents per node). Automatically handles frontmatter, parent linking, file paths, graph positioning, and mermaid validation.

**When to use:** After completing any non-trivial work — document what you did, files changed, and key decisions.

One node = one concept. If your work covers multiple independent concerns, create multiple nodes in one call using local parent references.

**Self-containment:** Nodes must embed all artifacts produced (diagrams, ASCII mockups, code, analysis). Never summarize an artifact — include it verbatim.

**Required when codeDiffs provided:** complexityScore and complexityExplanation must be included.

**Composition guidance:** Read addProgressTree.md before your first progress node for scope rules, when to split, and embedding standards.

**Node wiring:** Each node has a local \`id\`. Use \`parents\` (array) to reference other nodes' local ids — all parents are created before children. Nodes without \`parents\` attach to the top-level \`parentNodeId\` (or your task node by default). Diamond dependencies are supported: \`"parents": ["phase1", "phase2"]\`.

**Line limit:** Each node is limited to 60 lines (excluding codeDiffs and diagram). Nodes exceeding this limit block creation — split further.`,
            inputSchema: {
                callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
                parentNodeId: z.string().optional().describe('Existing graph node ID to attach root nodes to. Defaults to your task node.'),
                nodes: z.array(z.object({
                    id: z.string().describe('Local/temporary ID for wiring edges within this call'),
                    title: z.string().describe('Node title — one concept per node, concise and descriptive'),
                    summary: z.string().describe('Concise summary (1-3 lines) of what was accomplished'),
                    content: z.string().optional().describe('Complete work output as markdown. Embed all artifacts verbatim. Pass empty string if no artifacts produced.'),
                    color: z.string().optional().describe('Override node color. CSS named colors. Defaults to agent color.'),
                    diagram: z.string().optional().describe('Mermaid diagram source (without ```mermaid fences — tool adds them). Validated but non-blocking.'),
                    notes: z.array(z.string()).optional().describe('Array of notes: architecture impact, gotchas, tech debt.'),
                    codeDiffs: z.array(z.string()).optional().describe('Array of code diff strings. When provided, complexityScore and complexityExplanation are required.'),
                    filesChanged: z.array(z.string()).optional().describe('Array of file paths modified'),
                    complexityScore: z.enum(['low', 'medium', 'high']).optional().describe('Required when codeDiffs provided.'),
                    complexityExplanation: z.string().optional().describe('Required when codeDiffs provided.'),
                    linkedArtifacts: z.array(z.string()).optional().describe('Array of node basenames to wikilink in ## Related section.'),
                    parents: z.array(z.string()).optional().describe('Local ids of parent nodes within this call. Supports multiple parents for diamond dependencies. Nodes without parents become roots.'),
                })).describe('Array of nodes to create. At least 1 required. Each node needs id + title + summary at minimum.'),
            }
        },
        async ({callerTerminalId, parentNodeId, nodes}) =>
            createGraphTool({callerTerminalId, parentNodeId, nodes})
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

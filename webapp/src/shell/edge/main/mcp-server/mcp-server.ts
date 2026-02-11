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
import {addProgressNodeTool} from './addProgressNodeTool'

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
export type {AddProgressNodeParams} from './addProgressNodeTool'
export {addProgressNodeTool} from './addProgressNodeTool'

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
            description: 'Wait for specified agent terminals to complete. Returns when all agents have exited.',
            inputSchema: {
                terminalIds: z.array(z.string()).describe('Array of terminal IDs to wait for'),
                callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
                pollIntervalMs: z.number().optional().describe('Poll interval in ms (default: 5000)')
            }
        },
        async ({terminalIds, callerTerminalId, pollIntervalMs}) =>
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

    // Tool: add_progress_node
    server.registerTool(
        'add_progress_node',
        {
            title: 'Add Progress Node',
            description: `Create a progress node documenting your work. Automatically handles frontmatter (color, agent_name), parent linking, file path, graph positioning, and mermaid diagram validation.

**When to use:** After completing any non-trivial work — document what you did, files changed, and key decisions.

One node = one concept. If your work covers multiple independent concerns, call this tool multiple times.

**Required when codeDiffs provided:** complexityScore and complexityExplanation must be included.`,
            inputSchema: {
                callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
                title: z.string().describe('Node title — one concept per node, concise and descriptive'),
                summary: z.string().describe('Concise summary (1-3 lines) of what was accomplished. Always shown first.'),
                content: z.string().optional().describe('Optional freeform markdown body for longer details beyond the summary.'),
                codeDiffs: z.array(z.string()).optional().describe('Array of code diff strings. Each diff is rendered in a code block under ## DIFF. When provided, complexityScore and complexityExplanation are required.'),
                filesChanged: z.array(z.string()).optional().describe('Array of file paths you modified'),
                diagram: z.string().optional().describe('Mermaid diagram source (without ```mermaid fences — tool adds them). Validated before creation.'),
                notes: z.array(z.string()).optional().describe('Array of notes: architecture impact, gotchas, tech debt, difficulties. Rendered as bulleted ### NOTES section.'),
                linkedArtifacts: z.array(z.string()).optional().describe('Array of node basenames to wikilink in a ## Related section. Use for specs, proposals, related nodes.'),
                complexityScore: z.enum(['low', 'medium', 'high']).optional().describe('Required when codeDiffs provided. Complexity of the area worked in.'),
                complexityExplanation: z.string().optional().describe('Required when codeDiffs provided. Brief explanation of the complexity score.'),
                parentNodeId: z.string().optional().describe('Parent node ID to link to. Defaults to your task node.'),
                color: z.string().optional().describe('Override node color. Use CSS named colors: red, blue, green, yellow, orange, purple, pink, cyan, teal, brown, gray, lime, magenta, navy, olive, maroon, coral, crimson, gold, indigo, lavender, salmon, tomato, turquoise, violet. Defaults to your agent color.')
            }
        },
        async ({callerTerminalId, title, summary, content, codeDiffs, filesChanged, diagram, notes, linkedArtifacts, complexityScore, complexityExplanation, parentNodeId, color}) =>
            addProgressNodeTool({callerTerminalId, title, summary, content, codeDiffs, filesChanged, diagram, notes, linkedArtifacts, complexityScore, complexityExplanation, parentNodeId, color})
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

/**
 * MCP Server for Voicetree
 *
 * Exposes graph operations (spawn_agent, list_agents) via Model Context Protocol.
 * This server uses HTTP transport so it can run in-process with Electron and share state.
 *
 * Architecture:
 * - Uses pure functions from @vt/graph-model/pure/graph for graph operations
 * - Accesses state via shell functions (getGraph, getVaultPath)
 * - Executes effects via applyGraphDeltaToDBThroughMem
 * - Runs on HTTP transport at localhost:3001/mcp
 */

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {z} from 'zod'
import express, {type Express} from 'express'
import {findAvailablePort} from '@/shell/edge/main/electron/port-utils'
import {enableMcpJsonIntegration} from './mcp-client-config'

// Import tool implementations
import {spawnAgentTool} from './spawnAgentTool'
import {listAgentsTool} from './listAgentsTool'
import {waitForAgentsTool} from './waitForAgentsTool'
import {getUnseenNodesNearbyTool} from './getUnseenNodesNearbyTool'
import {sendMessageTool} from './sendMessageTool'
import {closeAgentTool} from './closeAgentTool'
import {readTerminalOutputTool} from './readTerminalOutputTool'
import {searchNodesTool as _searchNodesTool} from './searchNodesTool'
import {createGraphTool} from './createGraphTool'
import {graphStructureTool} from './graphStructureTool'
import {loadSettings} from '@/shell/edge/main/settings/settings_IO'
import type {VTSettings} from '@vt/graph-model/pure/settings/types'

// Imports for /trigger-overnight endpoint
import * as O from 'fp-ts/lib/Option.js'
import type {Graph, GraphDelta, NodeIdAndFilePath, Position} from '@vt/graph-model/pure/graph'
import {createTaskNode} from '@vt/graph-model/pure/graph/graph-operations/createTaskNode'
import {calculateNodePosition} from '@vt/graph-model/pure/graph/positioning/calculateInitialPosition'
import {buildSpatialIndexFromGraph} from '@vt/graph-model/pure/graph/positioning/spatialAdapters'
import type {SpatialIndex} from '@vt/graph-model/pure/graph/spatial'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getWritePath} from '@/shell/edge/main/graph/watch_folder/watchFolder'
import {applyGraphDeltaToDBThroughMemAndUIAndEditors} from '@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange'
import {spawnTerminalWithContextNode} from '@/shell/edge/main/terminals/spawnTerminalWithContextNode'

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
export type {GraphStructureParams} from './graphStructureTool'
export {graphStructureTool} from './graphStructureTool'

// ─── Overnight trigger ───────────────────────────────────────────────────────

interface TriggerOvernightParams {
    maxTasks?: number
    complexityThreshold?: number
    costCapUsd?: number
    dryRun?: boolean
}

interface TriggerOvernightResult {
    success: boolean
    terminalId?: string
    taskNodeId?: string
    error?: string
}

/**
 * Spawns a meta-observer agent for an overnight batch run.
 * Creates a task node, resolves the Opus agent, and launches with
 * the meta-observer SKILL.md prompt and user-provided parameters.
 */
async function triggerOvernight(params: TriggerOvernightParams): Promise<TriggerOvernightResult> {
    const vaultPathOpt: O.Option<string> = await getWritePath()
    if (O.isNone(vaultPathOpt)) {
        return {success: false, error: 'No vault loaded. Open a folder in VoiceTree first.'}
    }
    const writePath: string = vaultPathOpt.value

    const graph: Graph = getGraph()
    const nodeIds: readonly string[] = Object.keys(graph.nodes)
    if (nodeIds.length === 0) {
        return {success: false, error: 'Graph is empty — no nodes to anchor overnight run.'}
    }

    // Anchor the overnight run task node to the first graph node
    const parentNodeId: NodeIdAndFilePath = nodeIds[0] as NodeIdAndFilePath

    const spatialIndex: SpatialIndex = buildSpatialIndexFromGraph(graph)
    const position: Position = O.getOrElse(() => ({x: 0, y: 0}))(
        calculateNodePosition(graph, spatialIndex, parentNodeId)
    )

    const isoDate: string = new Date().toISOString().slice(0, 10)
    const taskDescription: string = `Overnight Run — ${isoDate}`

    const taskNodeDelta: GraphDelta = createTaskNode({
        taskDescription,
        selectedNodeIds: [parentNodeId],
        graph,
        writePath,
        position
    })

    const taskNodeId: NodeIdAndFilePath = taskNodeDelta[0].type === 'UpsertNode'
        ? taskNodeDelta[0].nodeToUpsert.absoluteFilePathIsID
        : '' as NodeIdAndFilePath

    if (!taskNodeId) {
        return {success: false, error: 'Failed to create task node'}
    }

    await applyGraphDeltaToDBThroughMemAndUIAndEditors(taskNodeDelta)

    // Resolve Opus agent command (find "Claude" in settings.agents)
    const settings: VTSettings = await loadSettings()
    const agents: readonly {readonly name: string; readonly command: string}[] = settings?.agents ?? []
    const claudeAgent: {readonly name: string; readonly command: string} | undefined =
        agents.find((a: {readonly name: string; readonly command: string}) => a.name === 'Claude')
    const agentCommand: string | undefined = claudeAgent?.command

    // Build meta-observer prompt with parameters
    const maxTasks: number = params.maxTasks ?? 3
    const complexityThreshold: number = params.complexityThreshold ?? 4
    const costCapUsd: number = params.costCapUsd ?? 5
    const dryRun: boolean = params.dryRun ?? false

    const agentPrompt: string = [
        'Read and follow ~/brain/workflows/meta/meta-observer/SKILL.md',
        '',
        'Parameters:',
        `MAX_TASKS=${maxTasks}`,
        `COMPLEXITY_THRESHOLD=${complexityThreshold}`,
        `COST_CAP_USD=${costCapUsd}`,
        `DRY_RUN=${dryRun}`,
        '',
        'After completing the BF task batch (or if no tasks qualify), run self-repair:',
        '1. Spawn a gardening agent: read and follow ~/brain/workflows/meta/gardening/SKILL.md with TARGET_PATH=~/brain/knowledge/ MODE=assess DEPTH_BUDGET=10',
        '2. Read ~/brain/working-memory/schedule.md for tree-sleep vault entries. Spawn tree-sleep agents (MODE=assess) only for vaults listed there. Skip any vault with fewer than 30 nodes.',
        'Include self-repair results in your meta-report.',
    ].join('\n')

    // Spawn agent — not headless (meta-observer needs wait_for_agents)
    const {terminalId}: {terminalId: string} = await spawnTerminalWithContextNode(
        taskNodeId,
        agentCommand,
        undefined,    // terminalCount
        true,         // skipFitAnimation
        false,        // startUnpinned
        undefined,    // selectedNodeIds
        undefined,    // spawnDirectory
        undefined,    // parentTerminalId
        undefined,    // promptTemplate
        false,        // headless
        undefined,    // inheritTerminalId
        {DEPTH_BUDGET: '3', AGENT_PROMPT: agentPrompt}
    )

    return {success: true, terminalId, taskNodeId}
}

// ─── MCP Server ──────────────────────────────────────────────────────────────

const MCP_BASE_PORT: 3001 = 3001 as const
let mcpPort: number = MCP_BASE_PORT

/**
 * Creates and configures the MCP server with Voicetree tools.
 */
export async function createMcpServer(): Promise<McpServer> {
    const settings: VTSettings = await loadSettings()
    const _lineLimit: number = settings.nodeLineLimit ?? 70
    void _lineLimit // used by validation integration (Phase 2)
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

**Pattern:** Decompose into nodes → spawn agents → (auto-monitored, you'll be notified on completion) → review with get_unseen_nodes_nearby.

**Prefer \`nodeId\` over \`task+parentNodeId\` when a node already describes the work.** Don't recreate what's already written — spawn directly on the existing node.

If no node exists yet, use task+parentNodeId to create a new task node first.`,
            inputSchema: {
                nodeId: z.string().optional().describe('Target node ID to attach the spawned agent (use this OR task+parentNodeId)'),
                callerTerminalId: z.string().describe('Your terminal ID, you must echo $VOICETREE_TERMINAL_ID to retrieve it if you have not yet.'),
                task: z.string().optional().describe('Task description for creating a new task node. The first line becomes the node title, the rest becomes the body. Requires parentNodeId.'),
                parentNodeId: z.string().optional().describe('Parent node ID under which to create the new task node (required when task is provided)'),
                spawnDirectory: z.string().optional().describe('Absolute path to spawn the agent in. By default, inherits the parent terminal\'s directory (worktree-safe). Only needed to override, for example to contain child-agent to a subfolder or new worktree'),
                promptTemplate: z.string().optional().describe('Name of an INJECT_ENV_VARS key to use as AGENT_PROMPT instead of the default. Must match an existing key in settings.'),
                agentName: z.string().optional().describe('Name of an agent from settings.agents to use (e.g., "Claude Sonnet"). If not provided, inherits the caller\'s agent type. Falls back to default agent from settings if caller has no type.'),
                headless: z.boolean().optional().describe('When true, agent runs as background process with no PTY/terminal UI. Output is via MCP tools (create_graph). Status shown as badge on task node.'),
                replaceSelf: z.boolean().optional().describe('When true, the successor inherits the caller\'s terminal ID and agent name. The caller\'s process is killed and replaced atomically. Use for context handover — the agent identity persists across context boundaries.'),
                depthBudget: z.number().optional().describe('Explicit DEPTH_BUDGET for the child agent. If omitted, auto-decrements from the caller\'s DEPTH_BUDGET (parent budget - 1). Controls recursive decomposition: budget > 0 = may spawn sub-agents, budget = 0 = leaf agent (no spawning).')
            }
        },
        async ({nodeId, callerTerminalId, task, parentNodeId, spawnDirectory, promptTemplate, agentName, headless, replaceSelf, depthBudget}) => spawnAgentTool({nodeId, callerTerminalId, task, parentNodeId, spawnDirectory, promptTemplate, agentName, headless, replaceSelf, depthBudget})
    )

    // Tool: list_agents
    server.registerTool(
        'list_agents',
        {
            title: 'List Agents',
            description: 'List running agent terminals with their status and newly created nodes. Also returns `availableAgents` — the names you can pass as `agentName` to spawn_agent.',
            inputSchema: {}
        },
        listAgentsTool
    )

    // Tool: wait_for_agents
    server.registerTool(
        'wait_for_agents',
        {
            title: 'Wait for Agents',
            description: 'Wait for specified agent terminals to complete. Returns immediately with a monitorId. The monitor polls in the background and sends a completion message to your terminal when all agents are done.\n\nIMPORTANT: This tool is non-blocking. After calling it, you should continue with other work or inform the user you are waiting. Do NOT manually poll agent status — a "[WaitForAgents] Agent(s) completed." message will be automatically injected into your terminal when all agents finish their work. You will see this message appear as if the user sent it.\n\nNOTE: spawn_agent now auto-starts a monitor, so you only need wait_for_agents for explicit multi-agent waits or custom polling intervals.',
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
            description: 'Close an agent terminal. After waiting for an agent to finish, review its work. Close the agent if satisfied with its output. Leave the agent open if any tech debt was introduced or if human review would be beneficial - open terminals signal to the user that attention is needed. Will error if the agent is still running — you must send them a message first to check remaining work, then override with forceWithReason if needed.',
            inputSchema: {
                terminalId: z.string().describe('The terminal ID of the agent to close'),
                callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
                forceWithReason: z.string().optional().describe('Required to close a running (non-idle) agent. Explain why you are force-closing.')
            }
        },
        async ({terminalId, callerTerminalId, forceWithReason}) =>
            await closeAgentTool({terminalId, callerTerminalId, forceWithReason})
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

    // Tool: search_nodes (temporarily disabled)
    // server.registerTool(
    //     'search_nodes',
    //     {
    //         title: 'Search Nodes',
    //         description: 'Search for semantically relevant nodes in the graph using hybrid vector + BM25 search. Use this to find related context, prior work, or relevant documentation within the markdown tree.',
    //         inputSchema: {
    //             query: z.string().describe('The search query text'),
    //             top_k: z.number().optional().describe('Number of results to return (default: 10)')
    //         }
    //     },
    //     async ({query, top_k}) => searchNodesTool({query, top_k})
    // )

    // Tool: create_graph
    server.registerTool(
        'create_graph',
        {
            title: 'Create Graph',
            description: `Create a graph of progress nodes in a single call. Supports trees, chains, fan-out, fan-in, and diamond dependencies (multiple parents per node). Automatically handles frontmatter, parent linking, file paths, graph positioning, and mermaid validation.

**When to use:** After completing any non-trivial work — document what you did, files changed, and key decisions.

One node = one concept. If your work covers multiple independent concerns, create multiple nodes in one call using parent references.

**Self-containment:** Nodes must embed all artifacts produced (diagrams, ASCII mockups, code, analysis). Never summarize an artifact — include it verbatim.

**Required when codeDiffs provided:** complexityScore and complexityExplanation must be included.

**Composition guidance:** Read addProgressTree.md before your first progress node for scope rules, when to split, and embedding standards.

**Node wiring:** Each node has a \`filename\` (with or without .md extension). Use \`parents\` (array) to reference other nodes' filenames — all parents are created before children. Nodes without \`parents\` attach to the top-level \`parentNodeId\` (or your task node by default). Diamond dependencies are supported: \`"parents": ["phase1", "phase2"]\`.

Split by concern:
Task: Review git diff
├── Review: Collision-aware positioning refactor
└── Review: Prompt template cleanup

Split by phase + option:
Task
├── High-level architecture
│   ├── Option A: Event-driven
│   └── Option B: Request-response
├── Data types
└── Pure functions`,
            inputSchema: {
                callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
                parentNodeId: z.string().optional().describe('Existing graph node ID to attach root nodes to. Defaults to your task node.'),
                outputPath: z.string().optional().describe('Optional absolute or relative directory path where new nodes should be written. Relative paths resolve from the current write path. The resolved path must stay inside the loaded vault paths (writePath or readPaths).'),
                nodes: z.array(z.object({
                    filename: z.string().describe('Filename for this node (with or without .md extension). Also used in `parents` to reference other nodes in this call.'),
                    title: z.string().describe('Node title — one concept per node, concise and descriptive'),
                    summary: z.string().describe('Concise summary (1-3 lines) of what was accomplished. Always shown first.'),
                    content: z.string().optional().describe('Complete work output as markdown. MUST contain all artifacts produced (diagrams, ASCII mockups, code snippets, analysis, tables, proposals). Embed artifacts verbatim — do not summarize what you created. The node must be self-contained: a reader should never need to look elsewhere to see what was produced. Pass empty string if no artifacts were produced.'),
                    color: z.string().optional().describe('Override node color. Use CSS named colors: red, blue, green, yellow, orange, purple, pink, cyan, teal, brown, gray, lime, magenta, navy, olive, maroon, coral, crimson, gold, indigo, lavender, salmon, tomato, turquoise, violet. Defaults to your agent color. Convention: use green for progress nodes that complete a task; use blue (default) for planning and in-progress work.'),
                    diagram: z.string().optional().describe('Mermaid diagram source (without ```mermaid fences — tool adds them). Validated but non-blocking.'),
                    notes: z.array(z.string()).optional().describe('Array of notes: architecture impact, gotchas, tech debt, difficulties. Rendered as bulleted ### NOTES section.'),
                    codeDiffs: z.array(z.string()).optional().describe('Array of code diff strings. Each diff is rendered in a code block under ## DIFF. When provided, complexityScore and complexityExplanation are required.'),
                    filesChanged: z.array(z.string()).optional().describe('Array of file paths you modified'),
                    complexityScore: z.enum(['low', 'medium', 'high']).optional().describe('Required when codeDiffs provided. Complexity of the area worked in.'),
                    complexityExplanation: z.string().optional().describe('Required when codeDiffs provided. Brief explanation of the complexity score.'),
                    linkedArtifacts: z.array(z.string()).optional().describe('Array of node basenames to render as markdown links in a ## Related section. Use for specs, proposals, or openspec artifacts without creating graph edges.'),
                    parents: z.array(z.object({
                        filename: z.string().describe('Filename of a parent node within this call'),
                        edgeLabel: z.string().describe('Relationship label shown on the edge (e.g. "implements", "extends", "blocked by"). Use empty string "" for generic parent-child links.')
                    })).optional().describe('Parent nodes within this call. Each entry is { filename, edgeLabel } where edgeLabel is required (use "" for generic parent-child links). Supports multiple parents for diamond dependencies. Nodes without parents become roots.'),
                })).describe('Array of nodes to create. At least 1 required. Each node needs filename + title + summary at minimum.'),
                override_with_rationale: z.array(z.object({
                    ruleId: z.enum(['grandparent_attachment', 'node_line_limit']),
                    rationale: z.string()
                })).optional().describe(
                    'Override validation rules that would otherwise block. '
                    + 'Each entry must match a rule ID from the error response.'
                ),
            }
        },
        async ({callerTerminalId, parentNodeId, outputPath, nodes, override_with_rationale}) =>
            createGraphTool({callerTerminalId, parentNodeId, outputPath, nodes, override_with_rationale})
    )

    // Tool: graph_structure
    server.registerTool(
        'graph_structure',
        {
            title: 'Get Graph Structure',
            description: 'Read .md files from a folder on disk and render the graph structure as an ASCII tree. Shows node hierarchy based on [[wikilink]] edges. Useful for understanding the topology of a markdown graph without reading every file. Excludes ctx-nodes/ folders.',
            inputSchema: {
                folderPath: z.string().describe('Absolute path to folder containing .md files'),
                withSummaries: z.boolean().optional().describe('Include the first few non-empty content lines below each node title in the ASCII tree. Skips frontmatter and the top-level # heading.'),
            }
        },
        async ({folderPath, withSummaries}) => graphStructureTool({folderPath, withSummaries})
    )

    return server
}

/**
 * Starts the MCP server with HTTP transport.
 * This allows the server to run in-process with Electron and share state.
 */
export async function startMcpServer(): Promise<void> {
    const app: Express = express()
    app.use(express.json())

    // Overnight trigger endpoint — bypasses MCP protocol for direct HTTP invocation
    app.post('/trigger-overnight', async (req, res) => {
        try {
            const params: TriggerOvernightParams = (req.body as TriggerOvernightParams | undefined) ?? {}
            const result: TriggerOvernightResult = await triggerOvernight(params)
            res.json(result)
        } catch (error) {
            const message: string = error instanceof Error ? error.message : String(error)
            res.status(500).json({success: false, error: message})
        }
    })

    app.post('/mcp', async (req, res) => {
        // ⚠️  SUSPICIOUS PATTERN — reviewed 2026-03-21, user flagged for closer review.
        // We create a fresh McpServer per request because sharing one instance causes
        // Protocol._onclose() on completed transports to corrupt shared state (_transport,
        // _responseHandlers), producing ~120s timeouts under concurrent requests.
        // Matches SDK official stateless example (simpleStatelessStreamableHttp.js).
        //
        // If any of these go wrong, re-examine this pattern first:
        //   - Tools stop responding / return stale data between requests
        //   - Memory growth under sustained load (server instances not GC'd)
        //   - Settings drift (loadSettings() is now called per request, not once at startup)
        //   - Errors during server.close() after response (check console for [MCP] errors)
        const server: McpServer = await createMcpServer()
        const transport: StreamableHTTPServerTransport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true
        })

        res.on('close', () => {
            void transport.close()
            void server.close()
        })

        try {
            await server.connect(transport)
            await transport.handleRequest(req, res, req.body)
        } catch (error) {
            console.error('[MCP] Error handling request:', error)
            if (!res.headersSent) {
                res.status(500).json({error: String(error)})
            }
        }
    })

    mcpPort = await findAvailablePort(MCP_BASE_PORT)

    app.listen(mcpPort, '127.0.0.1', () => {
        console.log(`[MCP] Voicetree MCP Server running on http://localhost:${mcpPort}/mcp`)
    })

    // Auto-write .mcp.json so external agents (e.g. manually-launched Claude Code) can discover this server.
    // Silently skips if no project folder is open yet (loadFolder will write it later).
    try {
        await enableMcpJsonIntegration()
    } catch (_e) {
        // No watched directory yet — loadFolder will call enableMcpJsonIntegration when one is set
    }
}

/**
 * Returns the MCP server port for configuration.
 */
export function getMcpPort(): number {
    return mcpPort
}

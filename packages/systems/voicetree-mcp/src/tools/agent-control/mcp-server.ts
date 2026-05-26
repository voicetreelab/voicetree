/**
 * MCP Server for Voicetree
 *
 * Exposes graph operations (spawn_agent, list_agents) via Model Context Protocol.
 * This server uses HTTP transport so it can run in-process with Electron and share state.
 *
 * Architecture:
 * - Uses pure functions from @vt/graph-model/pure/graph for graph operations
 * - Accesses state via shell functions (getGraph, getProjectRoot)
 * - Executes effects via applyGraphDeltaToDBThroughMem
 * - Runs on HTTP transport at localhost:3001/mcp
 */

import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {z} from 'zod'
import express, {type Express} from 'express'
import type {Server} from 'node:http'
import {findAvailablePort} from '../findAvailablePort'
import {enableMcpClientIntegrations} from '../mcpConfigDependencies'

// Import tool implementations
import {spawnAgentTool} from './spawnAgentTool'
import {listAgentsTool} from './listAgentsTool'
import {waitForAgentsTool} from './waitForAgentsTool'
import {getUnseenNodesNearbyTool} from './getUnseenNodesNearbyTool'
import {sendMessageTool} from './sendMessageTool'
import {closeAgentTool} from './closeAgentTool'
import {readTerminalOutputTool} from './readTerminalOutputTool'
import {createGraphTool} from '../createGraphDependencies'
import {graphStructureTool} from '../graph/graphStructureTool'
import {registerLiveTools} from '../live/registerLiveTools'
import {loadSettings} from '@vt/app-config/settings'
import type {VTSettings} from '@vt/graph-model/settings'
import {handleHookEventRequest, resolveHookEventName} from './hookEventHandler'
import {agentRuntime} from '@vt/agent-runtime'
import {mountTmuxAttachRelay} from '@vt/agent-runtime/relay/tmux-attach-relay.ts'
import * as path from 'node:path'
import {triggerOvernight, type TriggerOvernightParams, type TriggerOvernightResult} from '../system/triggerOvernight'

// Re-export types and tool functions for external use
export type {McpToolResponse} from '../toolResponse'
export {buildJsonResponse} from '../toolResponse'
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
export type {SearchNodesParams} from '../graph/searchNodesTool'
export {searchNodesTool} from '../graph/searchNodesTool'
export type {CreateGraphParams, CreateGraphNodeInput} from '../createGraphDependencies'
export {createGraphTool} from '../createGraphDependencies'
export type {GraphStructureParams} from '../graph/graphStructureTool'
export {graphStructureTool} from '../graph/graphStructureTool'
export type {DispatchLiveCommandParams, DispatchLiveCommandResult} from '../live/dispatchLiveCommandTool'
export {dispatchLiveCommandTool} from '../live/dispatchLiveCommandTool'
export {getLiveStateTool, getLiveState} from '../live/getLiveStateTool'

// ─── MCP Server ──────────────────────────────────────────────────────────────

const MCP_BASE_PORT: 3001 = 3001 as const

type McpPortCell = {
    readonly get: () => number
    readonly set: (next: number) => void
}

function createMcpPortCell(initial: number): McpPortCell {
    let current: number = initial
    return {
        get: (): number => current,
        set: (next: number): void => {
            current = next
        },
    }
}

const mcpPortCell: McpPortCell = createMcpPortCell(MCP_BASE_PORT)

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
                outputPath: z.string().optional().describe('Optional absolute or relative directory path where new nodes should be written. Relative paths resolve from the current write path. The resolved path must stay inside the loaded vault paths (writeFolder or readPaths).'),
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
            description: 'Read .md files from a folder on disk and render the graph structure as ASCII. Small folders default to a context-style view with a tree plus `## Node Contents`; larger folders default to compact topology only. Excludes ctx-nodes/ folders.',
            inputSchema: {
                folderPath: z.string().describe('Absolute path to folder containing .md files'),
                withSummaries: z.boolean().optional().describe('Tri-state summary control: `true` forces the context-style tree plus `## Node Contents`, `false` forces topology-only output, and omitting it auto-enables summaries only for folders with 30 or fewer nodes.'),
            }
        },
        async ({folderPath, withSummaries}) => graphStructureTool({folderPath, withSummaries})
    )

    registerLiveTools(server)

    return server
}

export interface StartMcpServerOptions {
    /**
     * Starting port for findAvailablePort. Defaults to 3001.
     * vt-mcpd passes --port through here to avoid colliding with a running Electron MCP.
     */
    readonly startPort?: number
    readonly logger?: {
        readonly log: (message: string) => void
        readonly error: (message: string, error: unknown) => void
    }
    readonly now?: () => number
    readonly triggerOvernight?: (params: TriggerOvernightParams) => Promise<TriggerOvernightResult>
    readonly enableClientIntegrations?: () => Promise<void>
}

function logMcpMessage(message: string): void {
    console.log(message)
}

function logMcpError(message: string, error: unknown): void {
    console.error(message, error)
}

function getCurrentTimeMs(): number {
    return Date.now()
}

export interface McpServerHandle {
    readonly port: number
    readonly stop: () => Promise<void>
}

/**
 * Starts the MCP server with HTTP transport.
 * This allows the server to run in-process with Electron (or vt-mcpd) and share state.
 */
export async function startMcpServer(options?: StartMcpServerOptions): Promise<McpServerHandle> {
    const app: Express = express()
    app.use(express.json())
    const log: (message: string) => void = options?.logger?.log ?? logMcpMessage
    const logError: (message: string, error: unknown) => void = options?.logger?.error ?? logMcpError
    const getNow: () => number = options?.now ?? getCurrentTimeMs
    const runTriggerOvernight: (params: TriggerOvernightParams) => Promise<TriggerOvernightResult> =
        options?.triggerOvernight ?? triggerOvernight
    const runEnableClientIntegrations: () => Promise<void> =
        options?.enableClientIntegrations ?? enableMcpClientIntegrations

    // Overnight trigger endpoint — bypasses MCP protocol for direct HTTP invocation
    app.post('/trigger-overnight', async (req, res) => {
        try {
            const params: TriggerOvernightParams = (req.body as TriggerOvernightParams | undefined) ?? {}
            const result: TriggerOvernightResult = await runTriggerOvernight(params)
            res.json(result)
        } catch (error) {
            const message: string = error instanceof Error ? error.message : String(error)
            res.status(500).json({success: false, error: message})
        }
    })

    // Read the in-memory lifecycle telemetry snapshot.
    app.get('/telemetry/lifecycle', (_req, res) => {
        res.json(agentRuntime.getTierTelemetrySnapshot())
    })

    // Agent lifecycle hook ingestion. Receives JSON-on-stdin payloads forwarded
    // from per-agent hook subprocesses (Claude Code Notification/Stop/...,
    // Codex Stop/...). The terminal-id arrives via query parameter (set from
    // $VOICETREE_TERMINAL_ID in the hook command); the event name comes from
    // the payload's hook_event_name field.
    //
    // Fail-quiet: any error returns 2xx with ok:false. We never want to
    // block the parent agent because our endpoint hiccuped.
    app.post('/hook/:source', (req, res) => {
        try {
            const response = handleHookEventRequest(
                {
                    source: req.params.source,
                    terminalId: typeof req.query.terminal === 'string' ? req.query.terminal : undefined,
                    hookEventName: resolveHookEventName(
                        req.body as Record<string, unknown> | undefined,
                        req.query as Record<string, unknown> | undefined,
                    ),
                },
                {updateAgentEvent: agentRuntime.updateTerminalAgentEvent},
            )
            res.json(response)
        } catch (error) {
            logError('[hook] error processing payload:', error)
            res.json({ok: false, reason: 'exception'})
        }
    })

    app.post('/mcp', async (req, res) => {
        log(`[MCP] arrived ${getNow()} method=${req.body?.params?.name ?? req.body?.method}`)
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
            logError('[MCP] Error handling request:', error)
            if (!res.headersSent) {
                res.status(500).json({error: String(error)})
            }
        }
    })

    const startPort: number = options?.startPort ?? MCP_BASE_PORT
    const mcpPort: number = await findAvailablePort(startPort)
    mcpPortCell.set(mcpPort)

    const httpServer: Server = app.listen(mcpPort, '127.0.0.1', () => {
        log(`[MCP] Voicetree MCP Server running on http://localhost:${mcpPort}/mcp`)
    })
    const tmuxAttachRelay = mountTmuxAttachRelay(httpServer, {
        getTmuxMouseMode: async (): Promise<boolean> => {
            const latestSettings: VTSettings = await loadSettings()
            return latestSettings.terminalTmuxMouseMode ?? false
        },
    })

    // Auto-write MCP client configs so external agents can discover this server.
    // Silently skips if no project folder is open yet (loadFolder will write it later).
    try {
        await runEnableClientIntegrations()
    } catch (_e) {
        // No watched directory yet — loadFolder will call enableMcpClientIntegrations when one is set
    }

    // Start tier-1 vs tier-3 telemetry: stream every lifecycle event to a
    // JSONL log under APP_SUPPORT. The in-memory ring is always populated;
    // the file is for offline analysis when we want to decide whether the
    // Tier-3 heuristic can be deleted.
    try {
        const appSupportPath: string = agentRuntime.getRuntimeEnv().getAppSupportPath()
        if (appSupportPath) {
            agentRuntime.installJsonlTelemetrySink(path.join(appSupportPath, 'lifecycle-telemetry.jsonl'))
        }
    } catch (error) {
        log(`[MCP] telemetry sink install skipped: ${error instanceof Error ? error.message : String(error)}`)
    }

    return {
        port: mcpPort,
        stop: (): Promise<void> =>
            new Promise<void>((resolve, reject) => {
                httpServer.close((err: Error | undefined): void => {
                    if (err) reject(err)
                    else resolve()
                })
                tmuxAttachRelay.close()
                ;(httpServer as unknown as { closeIdleConnections?: () => void }).closeIdleConnections?.()
            }),
    }
}

/**
 * Returns the MCP server port for configuration.
 */
export function getMcpPort(): number {
    return mcpPortCell.get()
}

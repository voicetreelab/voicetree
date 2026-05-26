// Tool catalog — pure data. Single source of truth for tool descriptions,
// input schemas, and handler bindings. Consumed by the unified HTTP daemon
// (`transport/httpServer.ts`) for input validation + dispatch, and by
// `transport/toolCatalog.ts` for the dispatcher map shape. The CLI manual
// (`packages/systems/voicetree-cli/prompts/cli-manual.md`) is the user-facing
// description surface; `transport/tests/catalogManualDrift.test.ts` asserts
// each description substring is present in that manual.
//
// Functional design: this file is data + thin adapters that delegate to the
// existing pure tool functions under `src/tools/`, `src/create-graph/`. No
// transport concerns live here — the catalog is transport-agnostic data, and
// each transport reads it.
//
// Twelve catalog entries match the spec set (design doc §4.1): the eleven
// from the former `registerAllTools` plus the formerly-unregistered
// `search_nodes` (design doc §2.2).

import {z} from 'zod'
import type {ZodTypeAny, ZodRawShape} from 'zod'

import type {McpToolResponse} from './toolResponse'
import {RPC_ROUTES, type RpcRoute} from '../rpc/index.ts'
import {spawnAgentTool} from './agent-control/spawnAgentTool'
import {listAgentsTool} from './agent-control/listAgentsTool'
import {waitForAgentsTool} from './agent-control/waitForAgentsTool'
import {getUnseenNodesNearbyTool} from './agent-control/getUnseenNodesNearbyTool'
import {sendMessageTool} from './agent-control/sendMessageTool'
import {closeAgentTool} from './agent-control/closeAgentTool'
import {readTerminalOutputTool} from './agent-control/readTerminalOutputTool'
import {createGraphTool} from '../create-graph/createGraphTool'
import {OVERRIDABLE_RULE_IDS} from '@vt/graph-validation'
import {graphStructureTool} from './graph/graphStructureTool'
import {searchNodesTool} from './graph/searchNodesTool'
import {dispatchLiveCommandTool} from './live/dispatchLiveCommandTool'
import {getLiveStateTool} from './live/getLiveStateTool'

export type CatalogHandler = (args: Record<string, unknown>) => Promise<McpToolResponse>

export interface CatalogEntry {
    readonly name: string
    readonly description: string
    readonly inputShape: ZodRawShape
    readonly handler: CatalogHandler
}

const DISPATCH_LIVE_COMMAND_DESCRIPTION: string = [
    'SerializedCommand payload. Shape per command.type:',
    '- SetFolderState: {type, viewId, path, state}',
    '- Select: {type, ids[], additive?}',
    '- Deselect: {type, ids[]}',
    '- Move: {type, id, to:{x,y}}',
    '- AddEdge: {type, source, edge:{targetId,label}}',
    '- RemoveEdge: {type, source, targetId}',
    '- RemoveNode: {type, id}',
    '- AddNode: {type, node} (full SerializedGraphNode)',
].join('\n')

function adapt<P>(fn: (params: P) => Promise<McpToolResponse> | McpToolResponse): CatalogHandler {
    return async (args: Record<string, unknown>): Promise<McpToolResponse> => fn(args as P)
}

// ─── Catalog entries ─────────────────────────────────────────────────────────

const SPAWN_AGENT: CatalogEntry = {
    name: 'spawn_agent',
    description: `Spawn an agent in the Voicetree graph. Prefer this over built-in subagents—users get visibility and control over the work.

**When to use:** Complex tasks, parallelizable subtasks, any work where user visibility matters.

**Pattern:** Decompose into nodes → spawn agents → (auto-monitored, you'll be notified on completion) → review with get_unseen_nodes_nearby.

**Prefer \`nodeId\` over \`task+parentNodeId\` when a node already describes the work.** Don't recreate what's already written — spawn directly on the existing node.

If no node exists yet, use task+parentNodeId to create a new task node first.`,
    inputShape: {
        nodeId: z.string().optional().describe('Target node ID to attach the spawned agent (use this OR task+parentNodeId)'),
        callerTerminalId: z.string().describe('Your terminal ID, you must echo $VOICETREE_TERMINAL_ID to retrieve it if you have not yet.'),
        task: z.string().optional().describe('Task description for creating a new task node. The first line becomes the node title, the rest becomes the body. Requires parentNodeId.'),
        parentNodeId: z.string().optional().describe('Parent node ID under which to create the new task node (required when task is provided)'),
        spawnDirectory: z.string().optional().describe('Absolute path to spawn the agent in. By default, inherits the parent terminal\'s directory (worktree-safe). Only needed to override, for example to contain child-agent to a subfolder or new worktree'),
        promptTemplate: z.string().optional().describe('Name of an INJECT_ENV_VARS key to use as AGENT_PROMPT instead of the default. Must match an existing key in settings.'),
        agentName: z.string().optional().describe('Name of an agent from settings.agents to use (e.g., "Claude Sonnet"). If not provided, inherits the caller\'s agent type. Falls back to default agent from settings if caller has no type.'),
        headless: z.boolean().optional().describe('When true, agent runs as background process with no PTY/terminal UI. Output is via MCP tools (create_graph). Status shown as badge on task node.'),
        replaceSelf: z.boolean().optional().describe('When true, the successor inherits the caller\'s terminal ID and agent name. The caller\'s process is killed and replaced atomically. Use for context handover — the agent identity persists across context boundaries.'),
        depthBudget: z.number().optional().describe('Explicit DEPTH_BUDGET for the child agent. If omitted, auto-decrements from the caller\'s DEPTH_BUDGET (parent budget - 1). Controls recursive decomposition: budget > 0 = may spawn sub-agents, budget = 0 = leaf agent (no spawning).'),
    },
    handler: adapt(spawnAgentTool),
}

const LIST_AGENTS: CatalogEntry = {
    name: 'list_agents',
    description: 'List running agent terminals with their status and newly created nodes. Also returns `availableAgents` — the names you can pass as `agentName` to spawn_agent.',
    inputShape: {},
    handler: adapt(listAgentsTool),
}

const WAIT_FOR_AGENTS: CatalogEntry = {
    name: 'wait_for_agents',
    description: 'Wait for specified agent terminals to complete. Returns immediately with a monitorId. The monitor polls in the background and sends a completion message to your terminal when all agents are done.\n\nIMPORTANT: This tool is non-blocking. After calling it, you should continue with other work or inform the user you are waiting. Do NOT manually poll agent status — a "[WaitForAgents] Agent(s) completed." message will be automatically injected into your terminal when all agents finish their work. You will see this message appear as if the user sent it.\n\nNOTE: spawn_agent now auto-starts a monitor, so you only need wait_for_agents for explicit multi-agent waits or custom polling intervals.',
    inputShape: {
        terminalIds: z.array(z.string()).describe('Array of terminal IDs to wait for'),
        callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
        pollIntervalMs: z.number().optional().describe('Poll interval in ms (default: 5000)'),
    },
    handler: adapt(waitForAgentsTool),
}

const GET_UNSEEN_NODES_NEARBY: CatalogEntry = {
    name: 'get_unseen_nodes_nearby',
    description: 'Get nodes near your context that were created after your context was generated. The user or other agents may have added nodes for you to read. Call this to check for new relevant information.',
    inputShape: {
        callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
        search_from_node: z.string().optional().describe('Optional node ID to search from instead of your task node'),
    },
    handler: adapt(getUnseenNodesNearbyTool),
}

const CLOSE_AGENT: CatalogEntry = {
    name: 'close_agent',
    description: 'Close an agent terminal. After waiting for an agent to finish, review its work. Close the agent if satisfied with its output. Leave the agent open if any tech debt was introduced or if human review would be beneficial - open terminals signal to the user that attention is needed. Will error if the agent is still running — you must send them a message first to check remaining work, then override with forceWithReason if needed.',
    inputShape: {
        terminalId: z.string().describe('The terminal ID of the agent to close'),
        callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
        forceWithReason: z.string().optional().describe('Required to close a running (non-idle) agent. Explain why you are force-closing.'),
    },
    handler: adapt(closeAgentTool),
}

const SEND_MESSAGE: CatalogEntry = {
    name: 'send_message',
    description: 'Send a message directly to an agent terminal. The message is injected into the terminal and executed (carriage return appended). Use this to provide follow-up instructions, answer prompts, or inject commands into a running agent.',
    inputShape: {
        terminalId: z.string().describe('The terminal ID of the agent to send the message to'),
        message: z.string().describe('The message/command to send to the terminal'),
        callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
    },
    handler: adapt(sendMessageTool),
}

const READ_TERMINAL_OUTPUT: CatalogEntry = {
    name: 'read_terminal_output',
    description: 'Read the last N characters of output from an agent terminal. Output has ANSI escape codes stripped for readability. Use this to check what an agent has printed, debug issues, or verify agent progress without waiting for completion.',
    inputShape: {
        terminalId: z.string().describe('The terminal ID of the agent to read output from'),
        callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
        nChars: z.number().optional().describe('Number of characters to return (default: 10000)'),
    },
    handler: adapt(readTerminalOutputTool),
}

const CREATE_GRAPH: CatalogEntry = {
    name: 'create_graph',
    description: `Create a graph of progress nodes in a single call. Supports trees, chains, fan-out, fan-in, and diamond dependencies (multiple parents per node). Automatically handles frontmatter, parent linking, file paths, graph positioning, and mermaid validation.

**When to use:** After completing any non-trivial work — document what you did, files changed, and key decisions.

One node = one concept. If your work covers multiple independent concerns, create multiple nodes in one call using parent references.

**Self-containment:** Nodes must embed all artifacts produced (diagrams, ASCII mockups, code, analysis). Never summarize an artifact — include it verbatim.

**Required when codeDiffs provided:** complexityScore and complexityExplanation must be included.

**Composition guidance:** Read addProgressTree.md before your first progress node for scope rules, when to split, and embedding standards.

**Node wiring:** Each node has a \`filename\` (with or without .md extension). Declare parents inside \`content\` using \`- parent [[other-filename|edge-label]]\` lines (one per line). The pipe-separated edge label is optional — use \`- parent [[other-filename]]\` for a generic parent link. All in-batch parents (filenames declared in this call) are created before children. Nodes with no \`- parent\` line attach to the top-level \`parentNodeId\` (or your task node by default). Diamond dependencies are supported: emit multiple \`- parent [[…]]\` lines.

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
└── Pure functions

**Schema validation (optional):** If the folder containing the new node has a folder note declaring \`## Type: <kind>\`, \`vt graph create\` runs a schema validator (from \`.voicetree/schemas.cjs\`) before writing. On rejection it exits non-zero with the violating rules. If no upstream Type is declared, validation is silent and the node is created normally.`,
    inputShape: {
        callerTerminalId: z.string().describe('Your terminal ID from $VOICETREE_TERMINAL_ID env var'),
        parentNodeId: z.string().optional().describe('Existing graph node ID to attach root nodes to. Defaults to your task node.'),
        outputPath: z.string().optional().describe('Optional absolute or relative directory path where new nodes should be written. Relative paths resolve from the current write folder. The resolved path must stay inside the loaded vault paths (writeFolder or readPaths).'),
        nodes: z.array(z.object({
            filename: z.string().describe('Filename for this node (with or without .md extension). Other nodes can reference this one via `- parent [[filename|edge-label]]` lines inside their `content`.'),
            title: z.string().describe('Node title — one concept per node, concise and descriptive'),
            summary: z.string().describe('Concise summary (1-3 lines) of what was accomplished. Always shown first.'),
            content: z.string().optional().describe('Complete work output as markdown. MUST contain all artifacts produced (diagrams, ASCII mockups, code snippets, analysis, tables, proposals). Embed artifacts verbatim — do not summarize what you created. The node must be self-contained: a reader should never need to look elsewhere to see what was produced. Declare parent edges with `- parent [[other-filename|edge-label]]` lines (label optional). Pass empty string if no artifacts were produced.'),
            color: z.string().optional().describe('Override node color. Use CSS named colors: red, blue, green, yellow, orange, purple, pink, cyan, teal, brown, gray, lime, magenta, navy, olive, maroon, coral, crimson, gold, indigo, lavender, salmon, tomato, turquoise, violet. Defaults to your agent color. Convention: use green for progress nodes that complete a task; use blue (default) for planning and in-progress work.'),
            diagram: z.string().optional().describe('Mermaid diagram source (without ```mermaid fences — tool adds them). Validated but non-blocking.'),
            notes: z.array(z.string()).optional().describe('Array of notes: architecture impact, gotchas, tech debt, difficulties. Rendered as bulleted ### NOTES section.'),
            codeDiffs: z.array(z.string()).optional().describe('Array of code diff strings. Each diff is rendered in a code block under ## DIFF. When provided, complexityScore and complexityExplanation are required.'),
            filesChanged: z.array(z.string()).optional().describe('Array of file paths you modified'),
            complexityScore: z.enum(['low', 'medium', 'high']).optional().describe('Required when codeDiffs provided. Complexity of the area worked in.'),
            complexityExplanation: z.string().optional().describe('Required when codeDiffs provided. Brief explanation of the complexity score.'),
            linkedArtifacts: z.array(z.string()).optional().describe('Array of node basenames to render as markdown links in a ## Related section. Use for specs, proposals, or openspec artifacts without creating graph edges.'),
        })).describe('Array of nodes to create. At least 1 required. Each node needs filename + title + summary at minimum.'),
        override_with_rationale: z.array(z.object({
            ruleId: z.enum(OVERRIDABLE_RULE_IDS),
            rationale: z.string(),
        })).optional().describe(
            'Override validation rules that would otherwise block. '
            + 'Each entry must match a rule ID from the error response.',
        ),
    },
    handler: adapt(createGraphTool),
}

const GRAPH_STRUCTURE: CatalogEntry = {
    name: 'graph_structure',
    description: 'Read .md files from a folder on disk and render the graph structure as ASCII. Small folders default to a context-style view with a tree plus `## Node Contents`; larger folders default to compact topology only. Excludes ctx-nodes/ folders.',
    inputShape: {
        folderPath: z.string().describe('Absolute path to folder containing .md files'),
        withSummaries: z.boolean().optional().describe('Tri-state summary control: `true` forces the context-style tree plus `## Node Contents`, `false` forces topology-only output, and omitting it auto-enables summaries only for folders with 30 or fewer nodes.'),
    },
    handler: adapt(graphStructureTool),
}

const SEARCH_NODES: CatalogEntry = {
    name: 'search_nodes',
    description: 'Semantic search across the active vault. Returns matching node paths ranked by relevance to the query. Stubbed until vector search is wired up; callers should expect an explicit "not yet available" response.',
    inputShape: {
        query: z.string().describe('Natural-language search query'),
        top_k: z.number().optional().describe('Maximum number of results to return (default: 10)'),
    },
    handler: adapt(searchNodesTool),
}

const VT_GET_LIVE_STATE: CatalogEntry = {
    name: 'vt_get_live_state',
    description: 'Return a SerializedState snapshot of the running app with graph, folderState, activeView, selection, layout, and revision. Matches the @vt/graph-state SerializedState schema so the CLI can hydrateState the output.',
    inputShape: {},
    handler: async (): Promise<McpToolResponse> => getLiveStateTool(),
}

const VT_DISPATCH_LIVE_COMMAND: CatalogEntry = {
    name: 'vt_dispatch_live_command',
    description: 'Apply a SerializedCommand to the running app. Returns {delta, revision}.',
    inputShape: {
        command: z.record(z.string(), z.unknown()).describe(DISPATCH_LIVE_COMMAND_DESCRIPTION),
    },
    handler: async (args: Record<string, unknown>): Promise<McpToolResponse> =>
        dispatchLiveCommandTool({command: args.command as never}),
}

export const TOOL_CATALOG: readonly CatalogEntry[] = [
    SPAWN_AGENT,
    LIST_AGENTS,
    WAIT_FOR_AGENTS,
    GET_UNSEEN_NODES_NEARBY,
    CLOSE_AGENT,
    SEND_MESSAGE,
    READ_TERMINAL_OUTPUT,
    CREATE_GRAPH,
    GRAPH_STRUCTURE,
    SEARCH_NODES,
    VT_GET_LIVE_STATE,
    VT_DISPATCH_LIVE_COMMAND,
] as const

/**
 * Build the dispatcher map consumed by the HTTP daemon's /rpc route. The
 * returned map keys by tool name and yields a validating handler that:
 *   1. Parses input through the entry's zod object (built from `inputShape`).
 *   2. On rejection, throws a `CatalogValidationError` carrying the structured
 *      zod issues so the transport can emit a JSON-RPC `validation_failed`
 *      (-32602) error with `data` populated (design doc §4.4).
 *   3. On success, delegates to the entry's handler with the parsed params.
 *
 * The 19 BF-376 outbound RPC routes (`RPC_ROUTES`) are merged in the same
 * way — they share the dispatch infrastructure but live outside
 * `TOOL_CATALOG` because they are not user-facing MCP tools (no manual
 * coverage check, no description leader).
 *
 * Pure: depends only on `TOOL_CATALOG` + `RPC_ROUTES` data, no I/O.
 */
export function buildCatalogDispatchMap(): ReadonlyMap<string, CatalogHandler> {
    const toolEntries: Array<[string, CatalogHandler]> = TOOL_CATALOG.map(
        (entry: CatalogEntry): [string, CatalogHandler] => {
            const schema: ZodTypeAny = z.object(entry.inputShape)
            const validating: CatalogHandler = async (args: Record<string, unknown>): Promise<McpToolResponse> => {
                const parsed: ReturnType<typeof schema.safeParse> = schema.safeParse(args)
                if (!parsed.success) {
                    throw new CatalogValidationError(entry.name, parsed.error.issues)
                }
                return entry.handler(parsed.data as Record<string, unknown>)
            }
            return [entry.name, validating]
        },
    )
    const rpcEntries: Array<[string, CatalogHandler]> = RPC_ROUTES.map(
        (route: RpcRoute): [string, CatalogHandler] => {
            // Routes whose request shape is `Record<string, never>` (the
            // arg-less reads) skip schema validation — `z.object({})` would
            // strip every field, hiding accidental extras silently. For routes
            // with declared `inputShape`, validate exactly like tool entries.
            if (!route.inputShape) {
                return [route.name, async (args: Record<string, unknown>): Promise<McpToolResponse> => route.handler(args)]
            }
            const schema: ZodTypeAny = z.object(route.inputShape)
            const validating: CatalogHandler = async (args: Record<string, unknown>): Promise<McpToolResponse> => {
                const parsed: ReturnType<typeof schema.safeParse> = schema.safeParse(args)
                if (!parsed.success) {
                    throw new CatalogValidationError(route.name, parsed.error.issues)
                }
                return route.handler(parsed.data as Record<string, unknown>)
            }
            return [route.name, validating]
        },
    )
    return new Map<string, CatalogHandler>([...toolEntries, ...rpcEntries])
}

export class CatalogValidationError extends Error {
    public readonly toolName: string
    public readonly issues: ReadonlyArray<unknown>

    public constructor(toolName: string, issues: ReadonlyArray<unknown>) {
        super(`Validation failed for tool "${toolName}"`)
        this.name = 'CatalogValidationError'
        this.toolName = toolName
        this.issues = issues
    }
}

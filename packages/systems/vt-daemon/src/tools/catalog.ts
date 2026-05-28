// Tool catalog — data + thin adapters. Each entry pairs a `ToolSpec`
// (the user-facing single source of truth, owned by `@vt/vt-daemon-protocol`)
// with the daemon-internal pieces it needs to dispatch RPCs: a zod input
// schema and a bridged handler.
//
// Functional design: this file is data + thin adapters that delegate to the
// existing pure tool functions under `src/tools/`, `src/create-graph/`. No
// transport concerns live here — the catalog is transport-agnostic data, and
// each transport reads it.
//
// Description text and per-input documentation come from the matching
// `ToolSpec`. `vt manual <verb>`, spawn-prompt injection, and the daemon's
// zod `.describe()` strings all source from the same spec, so changes to
// docs land in one place.

import {z} from 'zod'
import type {ZodTypeAny, ZodRawShape} from 'zod'

import type {McpToolResponse} from '@vt/vt-daemon/_shared/toolResponse.ts'
import {
    AGENT_LIST_SPEC,
    AGENT_WAIT_SPEC,
    CLOSE_AGENT_SPEC,
    CREATE_GRAPH_SPEC,
    GET_UNSEEN_NODES_NEARBY_SPEC,
    GRAPH_STRUCTURE_SPEC,
    METRICS_APPEND_SESSION_SPEC,
    METRICS_GET_SESSIONS_SPEC,
    READ_TERMINAL_OUTPUT_SPEC,
    SEARCH_NODES_SPEC,
    SEND_MESSAGE_SPEC,
    SPAWN_AGENT_SPEC,
    VT_DISPATCH_LIVE_COMMAND_SPEC,
    VT_GET_LIVE_STATE_SPEC,
} from '@vt/vt-daemon-protocol'
import {RPC_ROUTES, type RpcRoute} from '../rpc/index.ts'
import {makeSpawnAgentDeps, spawnAgentTool} from '../agent-runtime/agent-control/spawnAgentTool'
import {listAgentsTool} from '../agent-runtime/agent-control/listAgentsTool'
import {waitForAgentsTool} from '../agent-runtime/agent-control/waitForAgentsTool'
import {getUnseenNodesNearbyTool} from '../agent-runtime/agent-control/getUnseenNodesNearbyTool'
import {sendMessageTool} from '../agent-runtime/agent-control/sendMessageTool'
import {closeAgentTool} from '../agent-runtime/agent-control/closeAgentTool'
import {readTerminalOutputTool} from '../agent-runtime/agent-control/readTerminalOutputTool'
import {createGraphTool} from '../create-graph/createGraphTool'
import {OVERRIDABLE_RULE_IDS} from '@vt/graph-validation'
import {graphStructureTool} from './graph/graphStructureTool'
import {searchNodesTool} from './graph/searchNodesTool'
import {dispatchLiveCommandTool} from './dispatchLiveCommandTool'
import {getLiveStateTool} from './getLiveStateTool'
import {getSessionsTool} from './getSessionsTool'
import {appendSessionTool, type AppendSessionParams} from './appendSessionTool'
import {buildCatalogEntry, specDescribe} from './tool-spec-binding'
import type {McpToolBridges} from '../config/mcpBridges.ts'

export type CatalogHandler = (args: Record<string, unknown>) => Promise<McpToolResponse>

// Handlers declared on catalog entries take the bridges explicitly so
// they can be constructed once at boot and bound into the dispatch map
// without a hidden module-level cell. Tools that don't talk to the
// graph or search bridges ignore the second arg.
export type BridgedCatalogHandler = (args: Record<string, unknown>, bridges: McpToolBridges) => Promise<McpToolResponse>

export interface CatalogEntry {
    readonly name: string
    readonly description: string
    readonly inputShape: ZodRawShape
    readonly handler: BridgedCatalogHandler
}

function adapt<P>(fn: (params: P) => Promise<McpToolResponse> | McpToolResponse): BridgedCatalogHandler {
    return async (args: Record<string, unknown>): Promise<McpToolResponse> => fn(args as P)
}

function adaptWithGraph<P>(
    fn: (params: P, bridge: import('../config/mcpBridges.ts').GraphBridge) => Promise<McpToolResponse> | McpToolResponse,
): BridgedCatalogHandler {
    return async (args, bridges) => fn(args as P, bridges.graph)
}

// ─── Catalog entries ─────────────────────────────────────────────────────────

const spawnDescribe: (rpcPath: string) => string = specDescribe(SPAWN_AGENT_SPEC)
const SPAWN_AGENT: CatalogEntry = buildCatalogEntry(
    SPAWN_AGENT_SPEC,
    {
        nodeId: z.string().optional().describe(spawnDescribe('nodeId')),
        callerTerminalId: z.string().describe(spawnDescribe('callerTerminalId')),
        task: z.string().optional().describe(spawnDescribe('task')),
        parentNodeId: z.string().optional().describe(spawnDescribe('parentNodeId')),
        spawnDirectory: z.string().optional().describe(spawnDescribe('spawnDirectory')),
        promptTemplate: z.string().optional().describe(spawnDescribe('promptTemplate')),
        agentName: z.string().optional().describe(spawnDescribe('agentName')),
        headless: z.boolean().optional().describe(spawnDescribe('headless')),
        replaceSelf: z.boolean().optional().describe(spawnDescribe('replaceSelf')),
        depthBudget: z.number().optional().describe(spawnDescribe('depthBudget')),
    },
    async (args, bridges) =>
        spawnAgentTool(args as unknown as Parameters<typeof spawnAgentTool>[0], makeSpawnAgentDeps(bridges.graph)),
)

const LIST_AGENTS: CatalogEntry = buildCatalogEntry(
    AGENT_LIST_SPEC,
    {},
    async (_args, bridges) => listAgentsTool(bridges.graph),
)

const waitDescribe: (rpcPath: string) => string = specDescribe(AGENT_WAIT_SPEC)
const WAIT_FOR_AGENTS: CatalogEntry = buildCatalogEntry(
    AGENT_WAIT_SPEC,
    {
        terminalIds: z.array(z.string()).describe(waitDescribe('terminalIds')),
        callerTerminalId: z.string().describe(waitDescribe('callerTerminalId')),
        pollIntervalMs: z.number().optional().describe(waitDescribe('pollIntervalMs')),
    },
    adaptWithGraph(waitForAgentsTool),
)

const unseenDescribe: (rpcPath: string) => string = specDescribe(GET_UNSEEN_NODES_NEARBY_SPEC)
const GET_UNSEEN_NODES_NEARBY: CatalogEntry = buildCatalogEntry(
    GET_UNSEEN_NODES_NEARBY_SPEC,
    {
        callerTerminalId: z.string().describe(unseenDescribe('callerTerminalId')),
        search_from_node: z.string().optional().describe(unseenDescribe('search_from_node')),
    },
    adaptWithGraph(getUnseenNodesNearbyTool),
)

const closeDescribe: (rpcPath: string) => string = specDescribe(CLOSE_AGENT_SPEC)
const CLOSE_AGENT: CatalogEntry = buildCatalogEntry(
    CLOSE_AGENT_SPEC,
    {
        terminalId: z.string().describe(closeDescribe('terminalId')),
        callerTerminalId: z.string().describe(closeDescribe('callerTerminalId')),
        forceWithReason: z.string().optional().describe(closeDescribe('forceWithReason')),
    },
    adaptWithGraph(closeAgentTool),
)

const sendDescribe: (rpcPath: string) => string = specDescribe(SEND_MESSAGE_SPEC)
const SEND_MESSAGE: CatalogEntry = buildCatalogEntry(
    SEND_MESSAGE_SPEC,
    {
        terminalId: z.string().describe(sendDescribe('terminalId')),
        message: z.string().describe(sendDescribe('message')),
        callerTerminalId: z.string().describe(sendDescribe('callerTerminalId')),
    },
    adapt(sendMessageTool),
)

const readOutputDescribe: (rpcPath: string) => string = specDescribe(READ_TERMINAL_OUTPUT_SPEC)
const READ_TERMINAL_OUTPUT: CatalogEntry = buildCatalogEntry(
    READ_TERMINAL_OUTPUT_SPEC,
    {
        terminalId: z.string().describe(readOutputDescribe('terminalId')),
        callerTerminalId: z.string().describe(readOutputDescribe('callerTerminalId')),
        nChars: z.number().optional().describe(readOutputDescribe('nChars')),
    },
    adapt(readTerminalOutputTool),
)

// The create_graph entry has a nested `nodes[]` shape with its own
// per-field documentation. The top-level inputs (callerTerminalId,
// parentNodeId, outputPath, nodes, override_with_rationale) are
// sourced from the spec; the per-node-field descriptions stay local
// to this declaration because the spec models tools at the top level
// and not arbitrary nested object shapes.
const createGraphDescribe: (rpcPath: string) => string = specDescribe(CREATE_GRAPH_SPEC)
const CREATE_GRAPH: CatalogEntry = buildCatalogEntry(
    CREATE_GRAPH_SPEC,
    {
        callerTerminalId: z.string().describe(createGraphDescribe('callerTerminalId')),
        parentNodeId: z.string().optional().describe(createGraphDescribe('parentNodeId')),
        outputPath: z.string().optional().describe(
            'Optional absolute or relative directory path where new nodes should be written. Relative paths resolve from the current write folder. The resolved path must stay inside the loaded vault paths (writeFolder or readPaths).',
        ),
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
            'Override validation rules that would otherwise block. Each entry must match a rule ID from the error response.',
        ),
    },
    adaptWithGraph(createGraphTool),
)

const structureDescribe: (rpcPath: string) => string = specDescribe(GRAPH_STRUCTURE_SPEC)
const GRAPH_STRUCTURE: CatalogEntry = buildCatalogEntry(
    GRAPH_STRUCTURE_SPEC,
    {
        folderPath: z.string().describe(structureDescribe('folderPath')),
        withSummaries: z.boolean().optional().describe(structureDescribe('withSummaries')),
    },
    adapt(graphStructureTool),
)

const searchDescribe: (rpcPath: string) => string = specDescribe(SEARCH_NODES_SPEC)
const SEARCH_NODES: CatalogEntry = buildCatalogEntry(
    SEARCH_NODES_SPEC,
    {
        query: z.string().describe(searchDescribe('query')),
        top_k: z.number().optional().describe(searchDescribe('top_k')),
    },
    adapt(searchNodesTool),
)

const VT_GET_LIVE_STATE: CatalogEntry = buildCatalogEntry(
    VT_GET_LIVE_STATE_SPEC,
    {},
    async (): Promise<McpToolResponse> => getLiveStateTool(),
)

const dispatchDescribe: (rpcPath: string) => string = specDescribe(VT_DISPATCH_LIVE_COMMAND_SPEC)
const VT_DISPATCH_LIVE_COMMAND: CatalogEntry = buildCatalogEntry(
    VT_DISPATCH_LIVE_COMMAND_SPEC,
    {
        command: z.record(z.string(), z.unknown()).describe(dispatchDescribe('command')),
    },
    async (args: Record<string, unknown>): Promise<McpToolResponse> =>
        dispatchLiveCommandTool({command: args.command as never}),
)

const METRICS_GET_SESSIONS: CatalogEntry = buildCatalogEntry(
    METRICS_GET_SESSIONS_SPEC,
    {},
    async (): Promise<McpToolResponse> => getSessionsTool(),
)

const metricsAppendDescribe: (rpcPath: string) => string = specDescribe(METRICS_APPEND_SESSION_SPEC)
const METRICS_APPEND_SESSION: CatalogEntry = buildCatalogEntry(
    METRICS_APPEND_SESSION_SPEC,
    {
        sessionId: z.string().describe(metricsAppendDescribe('sessionId')),
        tokens: z.object({
            input: z.number().describe(metricsAppendDescribe('tokens.input')),
            output: z.number().describe(metricsAppendDescribe('tokens.output')),
            cacheRead: z.number().optional().describe(metricsAppendDescribe('tokens.cacheRead')),
        }).describe('Token usage for this session'),
        costUsd: z.number().describe(metricsAppendDescribe('costUsd')),
    },
    async (args: Record<string, unknown>): Promise<McpToolResponse> =>
        appendSessionTool(args as unknown as AppendSessionParams),
)

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
    METRICS_GET_SESSIONS,
    METRICS_APPEND_SESSION,
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
export function buildCatalogDispatchMap(bridges: McpToolBridges): ReadonlyMap<string, CatalogHandler> {
    const toolEntries: Array<[string, CatalogHandler]> = TOOL_CATALOG.map(
        (entry: CatalogEntry): [string, CatalogHandler] => {
            const schema: ZodTypeAny = z.object(entry.inputShape)
            const validating: CatalogHandler = async (args: Record<string, unknown>): Promise<McpToolResponse> => {
                const parsed: ReturnType<typeof schema.safeParse> = schema.safeParse(args)
                if (!parsed.success) {
                    throw new CatalogValidationError(entry.name, parsed.error.issues)
                }
                return entry.handler(parsed.data as Record<string, unknown>, bridges)
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

// Tool catalog — data + thin adapters. Each entry pairs a `ToolSpec`
// (the user-facing single source of truth, owned by `@vt/vt-daemon-protocol`)
// with the daemon-internal pieces it needs to dispatch RPCs: a zod input
// schema and a bridged handler.
//
// Catalog construction iterates `TOOL_SPECS` from the protocol package
// in order and pairs each spec by `rpcName` with a per-tool input-shape
// builder (`INPUT_SHAPES`) and handler (`HANDLERS`). A missing binding
// on either side throws at module load — there is no silent skip.
// Adding a new tool requires updating `TOOL_SPECS` in
// `@vt/vt-daemon-protocol` and both maps below.
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
import {TOOL_SPECS, type ToolSpec} from '@vt/vt-daemon-protocol'
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

// ─── Per-spec zod input shapes ───────────────────────────────────────────────
//
// Keyed by `ToolSpec.rpcName`. Each builder receives its spec so descriptions
// for individual zod fields can be pulled via `specDescribe(spec)('rpcName')`
// without re-typing the docs already declared on the spec.
//
// The `create_graph` entry models a nested `nodes[]` shape with its own
// per-field documentation; those nested descriptions stay inline here
// because the spec models tools at the top level and not arbitrary nested
// object shapes.

// ─── Input shapes ────────────────────────────────────────────────────────────
//
// Most tools take a flat record of primitive parameters, so their input shape
// is pure data: a field-name → type-code map in `FLAT_INPUTS`. Each field's
// zod `.describe()` text is still sourced from the matching `ToolSpec` input
// via `specDescribe`, so docs live in one place. Tools whose input nests
// objects/arrays keep a bespoke builder in `INPUT_SHAPES`.

// Compact zod type codes. A trailing '?' marks the field optional.
//   s = string, n = number, b = boolean, sa = string[]
type FlatFieldCode = 's' | 's?' | 'n' | 'n?' | 'b' | 'b?' | 'sa' | 'sa?'

const FLAT_INPUTS: Readonly<Record<string, Readonly<Record<string, FlatFieldCode>>>> = {
    spawn_agent: {
        nodeId: 's?',
        callerTerminalId: 's',
        task: 's?',
        parentNodeId: 's?',
        spawnDirectory: 's?',
        promptTemplate: 's?',
        agentName: 's?',
        headless: 'b?',
        replaceSelf: 'b?',
        depthBudget: 'n?',
    },
    list_agents: {},
    wait_for_agents: {terminalIds: 'sa', callerTerminalId: 's', pollIntervalMs: 'n?'},
    get_unseen_nodes_nearby: {callerTerminalId: 's', search_from_node: 's?'},
    close_agent: {terminalId: 's', callerTerminalId: 's', forceWithReason: 's?'},
    send_message: {terminalId: 's', message: 's', callerTerminalId: 's'},
    read_terminal_output: {terminalId: 's', callerTerminalId: 's', nChars: 'n?'},
    graph_structure: {folderPath: 's', withSummaries: 'b?'},
    search_nodes: {query: 's', top_k: 'n?'},
    vt_get_live_state: {},
    'metrics.getSessions': {},
}

function zodForFieldCode(code: FlatFieldCode): ZodTypeAny {
    const optional: boolean = code.endsWith('?')
    const base: string = optional ? code.slice(0, -1) : code
    const built: ZodTypeAny =
        base === 'n' ? z.number()
        : base === 'b' ? z.boolean()
        : base === 'sa' ? z.array(z.string())
        : z.string()
    return optional ? built.optional() : built
}

function flatInputShape(
    fields: Readonly<Record<string, FlatFieldCode>>,
    describe: (rpcPath: string) => string,
): ZodRawShape {
    return Object.fromEntries(
        Object.entries(fields).map(
            ([name, code]: [string, FlatFieldCode]): [string, ZodTypeAny] =>
                [name, zodForFieldCode(code).describe(describe(name))],
        ),
    )
}

type InputShapeBuilder = (spec: ToolSpec) => ZodRawShape

// Bespoke builders for tools whose input nests objects/arrays — these cannot
// be expressed as a flat type-code map in FLAT_INPUTS.
const INPUT_SHAPES: Readonly<Record<string, InputShapeBuilder>> = {
    create_graph: (spec) => {
        const d: (rpcPath: string) => string = specDescribe(spec)
        return {
            callerTerminalId: z.string().describe(d('callerTerminalId')),
            parentNodeId: z.string().optional().describe(d('parentNodeId')),
            outputPath: z.string().optional().describe(
                'Optional absolute or relative directory path where new nodes should be written. Relative paths resolve from the current write folder path. The resolved path must stay inside the loaded project paths (writeFolderPath or readPaths).',
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
        }
    },
    vt_dispatch_live_command: (spec) => {
        const d: (rpcPath: string) => string = specDescribe(spec)
        return {
            command: z.record(z.string(), z.unknown()).describe(d('command')),
        }
    },
    'metrics.appendSession': (spec) => {
        const d: (rpcPath: string) => string = specDescribe(spec)
        return {
            sessionId: z.string().describe(d('sessionId')),
            tokens: z.object({
                input: z.number().describe(d('tokens.input')),
                output: z.number().describe(d('tokens.output')),
                cacheRead: z.number().optional().describe(d('tokens.cacheRead')),
            }).describe('Token usage for this session'),
            costUsd: z.number().describe(d('costUsd')),
        }
    },
}

// ─── Per-spec handlers ───────────────────────────────────────────────────────

const HANDLERS: Readonly<Record<string, BridgedCatalogHandler>> = {
    spawn_agent: async (args, bridges): Promise<McpToolResponse> =>
        spawnAgentTool(args as unknown as Parameters<typeof spawnAgentTool>[0], makeSpawnAgentDeps(bridges.graph)),
    list_agents: async (_args, bridges): Promise<McpToolResponse> => listAgentsTool(bridges.graph),
    wait_for_agents: adaptWithGraph(waitForAgentsTool),
    get_unseen_nodes_nearby: adaptWithGraph(getUnseenNodesNearbyTool),
    close_agent: adaptWithGraph(closeAgentTool),
    send_message: adapt(sendMessageTool),
    read_terminal_output: adapt(readTerminalOutputTool),
    create_graph: adaptWithGraph(createGraphTool),
    graph_structure: adapt(graphStructureTool),
    search_nodes: adapt(searchNodesTool),
    vt_get_live_state: async (): Promise<McpToolResponse> => getLiveStateTool(),
    vt_dispatch_live_command: async (args: Record<string, unknown>): Promise<McpToolResponse> =>
        dispatchLiveCommandTool({command: args.command as never}),
    'metrics.getSessions': async (): Promise<McpToolResponse> => getSessionsTool(),
    'metrics.appendSession': async (args: Record<string, unknown>): Promise<McpToolResponse> =>
        appendSessionTool(args as unknown as AppendSessionParams),
}

function resolveInputShape(spec: ToolSpec, rpcName: string): ZodRawShape {
    const flat: Readonly<Record<string, FlatFieldCode>> | undefined = FLAT_INPUTS[rpcName]
    if (flat !== undefined) return flatInputShape(flat, specDescribe(spec))
    const bespoke: InputShapeBuilder | undefined = INPUT_SHAPES[rpcName]
    if (bespoke !== undefined) return bespoke(spec)
    throw new Error(
        `catalog: TOOL_SPECS entry '${rpcName}' has no input-shape binding. `
        + `Add primitive fields to FLAT_INPUTS or a nested builder to INPUT_SHAPES in `
        + `packages/systems/vt-daemon/src/tools/catalog.ts when adding a new tool.`,
    )
}

function buildToolCatalog(): readonly CatalogEntry[] {
    return TOOL_SPECS.map((spec: ToolSpec): CatalogEntry => {
        const rpcName: string | undefined = spec.rpcName
        if (rpcName === undefined) {
            throw new Error(
                `catalog: TOOL_SPECS entry ${spec.cliVerb} must have an rpcName`,
            )
        }
        const handler: BridgedCatalogHandler | undefined = HANDLERS[rpcName]
        if (!handler) {
            throw new Error(
                `catalog: TOOL_SPECS entry '${rpcName}' has no HANDLERS binding. `
                + `Add one in packages/systems/vt-daemon/src/tools/catalog.ts when adding a new tool.`,
            )
        }
        return buildCatalogEntry(spec, rpcName, resolveInputShape(spec, rpcName), handler)
    })
}

export const TOOL_CATALOG: readonly CatalogEntry[] = buildToolCatalog()

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

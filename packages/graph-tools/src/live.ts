/**
 * BF-163 · L1-LIVE3 — live CLI command implementations.
 *
 * Three operations bridging the CLI to a running Electron app via LiveTransport:
 *   - liveStateDump  → vt_get_live_state → print SerializedState JSON
 *   - liveApply      → vt_dispatch_live_command → print Delta JSON
 *   - liveView       → dispatch collapse/select + vt_get_live_state → ASCII tree
 */
import {hydrateCommand, serializeState, type SerializedCommand} from '@vt/graph-state'
import type {Command, Delta} from '@vt/graph-state/contract'

import {createLiveTransport, DEFAULT_MCP_PORT} from './liveTransport'
import {renderProjectedLiveView} from './projectedLiveView'
import type {ViewFormat, ViewGraphResult} from './viewGraph'
import {renderFocus, renderNeighbors, renderPath} from './egoGraph'

// ── helpers ────────────────────────────────────────────────────────────────

function getMcpPort(portOverride?: number): number {
    const envPort = process.env.VOICETREE_MCP_PORT
    if (portOverride !== undefined) return portOverride
    return envPort ? parseInt(envPort, 10) : DEFAULT_MCP_PORT
}

function formatJson(value: unknown, pretty: boolean): string {
    return pretty ? `${JSON.stringify(value, null, 2)}\n` : `${JSON.stringify(value)}\n`
}

// ── live state dump ────────────────────────────────────────────────────────

export interface LiveStateDumpOptions {
    readonly port?: number
    readonly pretty?: boolean
}

export interface LiveStateDumpResult {
    readonly json: string
}

export async function liveStateDump(options: LiveStateDumpOptions = {}): Promise<LiveStateDumpResult> {
    const transport = createLiveTransport(getMcpPort(options.port))
    const state = await transport.getLiveState()
    const serialized = serializeState(state)
    const json = formatJson(serialized, options.pretty !== false)
    return {json}
}

// ── live apply ─────────────────────────────────────────────────────────────

const VALID_COMMAND_TYPES = new Set([
    'Collapse', 'Expand', 'Select', 'Deselect',
    'AddNode', 'RemoveNode', 'AddEdge', 'RemoveEdge',
    'Move', 'LoadRoot', 'UnloadRoot',
])

export interface LiveApplyOptions {
    readonly port?: number
    readonly pretty?: boolean
}

export interface LiveApplyResult {
    readonly output: string
    readonly delta: Delta
}

export async function liveApply(cmdJson: string, options: LiveApplyOptions = {}): Promise<LiveApplyResult> {
    let parsed: unknown
    try {
        parsed = JSON.parse(cmdJson)
    } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        throw new Error(`Failed to parse command JSON: ${msg}`)
    }

    if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) {
        throw new Error('Command JSON must be an object with a "type" field')
    }

    const typedParsed = parsed as {type: unknown}
    if (typeof typedParsed.type !== 'string' || !VALID_COMMAND_TYPES.has(typedParsed.type)) {
        throw new Error(
            `Unknown command type: "${typedParsed.type}"\nExpected one of: ${[...VALID_COMMAND_TYPES].join(', ')}`,
        )
    }

    const cmd: Command = hydrateCommand(parsed as SerializedCommand)
    const transport = createLiveTransport(getMcpPort(options.port))
    const delta = await transport.dispatchLiveCommand(cmd)
    const output = formatJson(delta, options.pretty !== false)
    return {output, delta}
}

// ── live view ──────────────────────────────────────────────────────────────

export interface LiveViewOptions {
    readonly collapsedFolders?: readonly string[]
    readonly selectedIds?: readonly string[]
    readonly format?: ViewFormat
    readonly port?: number
}

export async function liveView(options: LiveViewOptions = {}): Promise<ViewGraphResult> {
    const port = getMcpPort(options.port)
    const transport = createLiveTransport(port)

    // Dispatch any collapse commands first (idempotent — if already collapsed, noop)
    for (const folder of options.collapsedFolders ?? []) {
        const folderId = folder.endsWith('/') ? folder : `${folder}/`
        try {
            await transport.dispatchLiveCommand({type: 'Collapse', folder: folderId})
        } catch (error) {
            // best-effort: log but don't block rendering
            process.stderr.write(
                `[live view] collapse ${folder} failed (non-fatal): ${error instanceof Error ? error.message : String(error)}\n`,
            )
        }
    }

    // Dispatch select command if --select flags were provided
    const selectedIds = options.selectedIds ?? []
    if (selectedIds.length > 0) {
        try {
            await transport.dispatchLiveCommand({
                type: 'Select',
                ids: selectedIds,
            })
        } catch (error) {
            process.stderr.write(
                `[live view] select failed (non-fatal): ${error instanceof Error ? error.message : String(error)}\n`,
            )
        }
    }

    const state = await transport.getLiveState()
    if (state.roots.loaded.size === 0) {
        return {
            format: options.format ?? 'ascii',
            output: '(no loaded roots in live state)',
            nodeCount: 0,
            folderNodeCount: 0,
            fileNodeCount: 0,
            virtualFolderCount: 0,
        }
    }

    return renderProjectedLiveView(state, {
        format: options.format ?? 'ascii',
    })
}

// ── live ego-graph queries (BF-200) ────────────────────────────────────────────

export interface LiveFocusOptions {
    readonly port?: number
    readonly hops?: number
}

export interface LiveNeighborsOptions {
    readonly port?: number
    readonly hops?: number
}

export interface LivePathOptions {
    readonly port?: number
}

export async function liveFocus(nodeId: string, options: LiveFocusOptions = {}): Promise<string> {
    const transport = createLiveTransport(getMcpPort(options.port))
    const state = await transport.getLiveState()
    return renderFocus(state.graph, nodeId, options.hops ?? 1)
}

export async function liveNeighbors(nodeId: string, options: LiveNeighborsOptions = {}): Promise<string> {
    const transport = createLiveTransport(getMcpPort(options.port))
    const state = await transport.getLiveState()
    return renderNeighbors(state.graph, nodeId, options.hops ?? 1)
}

export async function livePath(nodeA: string, nodeB: string, options: LivePathOptions = {}): Promise<string> {
    const transport = createLiveTransport(getMcpPort(options.port))
    const state = await transport.getLiveState()
    return renderPath(state.graph, nodeA, nodeB)
}

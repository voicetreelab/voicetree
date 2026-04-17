/**
 * BF-163 · L1-LIVE3 — thin MCP-SDK wrapper implementing LiveTransport.
 *
 * Connects to a running Electron app's MCP server at localhost:$VOICETREE_MCP_PORT
 * (default 3002) via StreamableHTTP. Exposes getLiveState + dispatchLiveCommand.
 *
 * One-shot client per call: each method opens, calls, closes. Fine for CLI usage
 * where calls are infrequent.
 */
import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {hydrateState, serializeCommand, type SerializedState} from '@vt/graph-state'
import type {Command, Delta, State} from '@vt/graph-state/contract'

export const DEFAULT_MCP_PORT = 3002

interface SerializableDelta {
    readonly revision: number
    readonly cause: unknown
    readonly collapseAdded?: readonly string[]
    readonly collapseRemoved?: readonly string[]
    readonly selectionAdded?: readonly string[]
    readonly selectionRemoved?: readonly string[]
}

interface DispatchResult {
    readonly delta: SerializableDelta
    readonly revision: number
    readonly error?: string
}

export interface LiveTransport {
    readonly getLiveState: () => Promise<State>
    readonly dispatchLiveCommand: (cmd: Command) => Promise<Delta>
}

async function callMcpTool<T>(
    port: number,
    toolName: string,
    toolArgs: Record<string, unknown>,
): Promise<T> {
    const client = new Client({name: 'vt-graph-live', version: '1.0.0'})
    const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${port}/mcp`),
    )
    await client.connect(transport)
    try {
        const result: {
            isError?: boolean
            content?: Array<{type: string; text?: string}>
        } = await client.callTool({name: toolName, arguments: toolArgs})

        if (result.isError) {
            const errBlock = (result.content ?? []).find((c) => c.type === 'text')
            throw new Error(`MCP tool ${toolName} returned error: ${errBlock?.text ?? 'unknown'}`)
        }

        const textBlock = (result.content ?? []).find((c) => c.type === 'text')
        if (!textBlock?.text) {
            throw new Error(`MCP tool ${toolName} returned no text content`)
        }

        return JSON.parse(textBlock.text) as T
    } finally {
        await client.close()
    }
}

export function createLiveTransport(port: number = DEFAULT_MCP_PORT): LiveTransport {
    return {
        async getLiveState(): Promise<State> {
            const serialized = await callMcpTool<SerializedState>(port, 'vt_get_live_state', {})
            return hydrateState(serialized)
        },

        async dispatchLiveCommand(cmd: Command): Promise<Delta> {
            const serialized = serializeCommand(cmd)
            const result = await callMcpTool<DispatchResult>(port, 'vt_dispatch_live_command', {
                command: serialized,
            })
            if (result.error) {
                process.stderr.write(
                    `[live] command ${cmd.type} not-yet-wired on server: ${result.error}\n`,
                )
            }
            return {
                revision: result.delta.revision,
                cause: cmd,
                ...(result.delta.collapseAdded ? {collapseAdded: result.delta.collapseAdded} : {}),
                ...(result.delta.collapseRemoved ? {collapseRemoved: result.delta.collapseRemoved} : {}),
                ...(result.delta.selectionAdded ? {selectionAdded: result.delta.selectionAdded} : {}),
                ...(result.delta.selectionRemoved ? {selectionRemoved: result.delta.selectionRemoved} : {}),
            }
        },
    }
}

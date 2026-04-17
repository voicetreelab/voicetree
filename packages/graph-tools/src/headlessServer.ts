/**
 * BF-188 — data-layer-only MCP server (headless).
 *
 * No Electron, no cytoscape, no UI. Exposes vt_get_live_state +
 * vt_dispatch_live_command via StreamableHTTP on an ephemeral port.
 * Default port is 0 (OS picks an available port — never 3002).
 */
import path from 'path'
import express, {type Express} from 'express'
import type {Server} from 'http'
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js'
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import {z} from 'zod'
import {
    emptyState,
    buildStateFromVault,
    serializeState,
    hydrateCommand,
    applyCommandWithDelta,
    applyCommandAsyncWithDelta,
    type SerializedCommand,
} from '@vt/graph-state'
import type {State, Delta} from '@vt/graph-state/contract'

// ── delta serialization (shape liveTransport.ts DispatchResult expects) ───────

interface SerializableDelta {
    readonly revision: number
    readonly cause: unknown
    readonly collapseAdded?: readonly string[]
    readonly collapseRemoved?: readonly string[]
    readonly selectionAdded?: readonly string[]
    readonly selectionRemoved?: readonly string[]
    readonly rootsLoaded?: readonly string[]
    readonly rootsUnloaded?: readonly string[]
}

function toSerializableDelta(delta: Delta, cause: SerializedCommand): SerializableDelta {
    return {
        revision: delta.revision,
        cause,
        ...(delta.collapseAdded ? {collapseAdded: [...delta.collapseAdded]} : {}),
        ...(delta.collapseRemoved ? {collapseRemoved: [...delta.collapseRemoved]} : {}),
        ...(delta.selectionAdded ? {selectionAdded: [...delta.selectionAdded]} : {}),
        ...(delta.selectionRemoved ? {selectionRemoved: [...delta.selectionRemoved]} : {}),
        ...(delta.rootsLoaded ? {rootsLoaded: [...delta.rootsLoaded]} : {}),
        ...(delta.rootsUnloaded ? {rootsUnloaded: [...delta.rootsUnloaded]} : {}),
    }
}

function mcpResponse(payload: unknown, isError?: boolean) {
    return {
        content: [{type: 'text' as const, text: JSON.stringify(payload)}],
        ...(isError ? {isError: true} : {}),
    }
}

// ── MCP tool registration ─────────────────────────────────────────────────────

function registerHeadlessTools(
    server: McpServer,
    getState: () => State,
    setState: (s: State) => void,
): void {
    server.registerTool(
        'vt_get_live_state',
        {
            title: 'Get Live State (headless)',
            description: 'Returns current SerializedState of the headless server.',
            inputSchema: {},
        },
        async () => {
            try {
                return mcpResponse(serializeState(getState()))
            } catch (error) {
                return mcpResponse({error: error instanceof Error ? error.message : String(error)}, true)
            }
        },
    )

    server.registerTool(
        'vt_dispatch_live_command',
        {
            title: 'Dispatch Live Command (headless)',
            description: 'Apply a SerializedCommand to the headless state. Returns {delta, revision}.',
            inputSchema: {
                command: z.record(z.string(), z.unknown()).describe('SerializedCommand payload'),
            },
        },
        async (args: {command: Record<string, unknown>}) => {
            try {
                const serializedCommand = args.command as SerializedCommand
                const cmd = hydrateCommand(serializedCommand)
                const {state, delta} = cmd.type === 'LoadRoot'
                    ? await applyCommandAsyncWithDelta(getState(), cmd)
                    : applyCommandWithDelta(getState(), cmd)
                setState(state)
                return mcpResponse({
                    delta: toSerializableDelta(delta, serializedCommand),
                    revision: delta.revision,
                })
            } catch (error) {
                return mcpResponse({error: error instanceof Error ? error.message : String(error)}, true)
            }
        },
    )
}

// ── public API ────────────────────────────────────────────────────────────────

export interface HeadlessServerOptions {
    readonly port?: number
    readonly vaultPath?: string
}

export interface HeadlessServer {
    readonly port: number
    readonly close: () => Promise<void>
}

export async function createHeadlessServer(options: HeadlessServerOptions = {}): Promise<HeadlessServer> {
    let state: State = emptyState()

    if (options.vaultPath) {
        const resolved = path.resolve(options.vaultPath)
        state = await buildStateFromVault(resolved, resolved)
    }

    const app: Express = express()
    app.use(express.json())

    app.post('/mcp', async (req, res) => {
        const server = new McpServer({name: 'vt-headless', version: '1.0.0'})
        registerHeadlessTools(
            server,
            () => state,
            (s) => { state = s },
        )
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: undefined,
            enableJsonResponse: true,
        })
        res.on('close', () => {
            void transport.close()
            void server.close()
        })
        try {
            await server.connect(transport)
            await transport.handleRequest(req, res, req.body as Record<string, unknown>)
        } catch (error) {
            if (!res.headersSent) res.status(500).json({error: String(error)})
        }
    })

    const httpServer: Server = await new Promise<Server>((resolve) => {
        const srv = app.listen(options.port ?? 0, '127.0.0.1', () => resolve(srv))
    })

    const address = httpServer.address()
    const boundPort = typeof address === 'object' && address !== null ? address.port : (options.port ?? 0)

    return {
        port: boundPort,
        close: () => new Promise<void>((resolve) => httpServer.close(() => resolve())),
    }
}

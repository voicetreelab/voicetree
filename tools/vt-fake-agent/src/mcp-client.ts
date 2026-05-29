// vt-fake-agent's tool-call client. Talks to the unified VoiceTree daemon's
// JSON-RPC endpoint (POST /rpc) via @vt/vt-rpc. Replaces the prior
// @modelcontextprotocol/sdk StreamableHTTPClientTransport (against the
// removed /mcp endpoint).
//
// Discovery: createRpcClient resolves `$VOICETREE_DAEMON_URL` (set by the
// spawn parent — buildTerminalEnvVars.ts §5.3) and reads the bearer token
// from `$VOICETREE_PROJECT_PATH/.voicetree/auth-token`. The McpClient
// interface signatures are preserved verbatim so the executor (executor.ts)
// remains untouched by transport changes.

import {createRpcClient, type JsonRpcResponse} from '@vt/vt-rpc'

export interface McpClient {
    createGraph(callerTerminalId: string, nodes: Array<{filename: string; title: string; summary: string; content?: string; color?: string}>, outputPath?: string): Promise<unknown>
    spawnAgent(callerTerminalId: string, task: string, parentNodeId: string, opts?: {depthBudget?: number; headless?: boolean}): Promise<{terminalId: string}>
    waitForAgents(callerTerminalId: string, terminalIds: string[], pollIntervalMs?: number): Promise<{monitorId?: string; status: string; terminalIds?: string[]; message?: string}>
    sendMessage(callerTerminalId: string, targetTerminalId: string, message: string): Promise<unknown>
    listAgents(callerTerminalId: string): Promise<Array<{terminalId: string; agentName: string; status: string}>>
    closeAgent(callerTerminalId: string, terminalId: string): Promise<unknown>
    disconnect(): Promise<void>
}

// The daemon's tool handlers return their already-shaped payload as the
// JSON-RPC `result`. Failures arrive as JSON-RPC `error`; we surface them
// as thrown `Error` for parity with the prior parseToolResult contract so
// executor.ts's try/catch sites behave identically.
function unwrap(response: JsonRpcResponse): unknown {
    if ('error' in response) {
        const {code, message, data} = response.error
        const dataSuffix: string = data !== undefined ? ` data=${JSON.stringify(data)}` : ''
        throw new Error(`vt-fake-agent rpc error (${code}): ${message}${dataSuffix}`)
    }
    return response.result
}

export async function connectToMcp(): Promise<McpClient> {
    const client = await createRpcClient({env: process.env})

    return {
        async createGraph(callerTerminalId, nodes, outputPath) {
            const params: Record<string, unknown> = {callerTerminalId, nodes}
            if (outputPath !== undefined && outputPath.length > 0) params.outputPath = outputPath
            return unwrap(await client.call('create_graph', params))
        },

        async spawnAgent(callerTerminalId, task, parentNodeId, opts) {
            const params: Record<string, unknown> = {callerTerminalId, task, parentNodeId}
            if (opts?.depthBudget !== undefined) params.depthBudget = opts.depthBudget
            if (opts?.headless !== undefined) params.headless = opts.headless
            return unwrap(await client.call('spawn_agent', params)) as {terminalId: string}
        },

        async waitForAgents(callerTerminalId, terminalIds, pollIntervalMs) {
            const params: Record<string, unknown> = {callerTerminalId, terminalIds}
            if (pollIntervalMs !== undefined) params.pollIntervalMs = pollIntervalMs
            return unwrap(await client.call('wait_for_agents', params)) as {
                monitorId?: string
                status: string
                terminalIds?: string[]
                message?: string
            }
        },

        async sendMessage(callerTerminalId, targetTerminalId, message) {
            // The daemon catalog names the target as `terminalId` (not
            // `targetTerminalId`) per packages/systems/vt-daemon/src/tools/catalog.ts.
            return unwrap(await client.call('send_message', {
                callerTerminalId,
                terminalId: targetTerminalId,
                message,
            }))
        },

        async listAgents(_callerTerminalId) {
            // list_agents takes no arguments per the catalog inputShape.
            return unwrap(await client.call('list_agents', {})) as Array<{
                terminalId: string
                agentName: string
                status: string
            }>
        },

        async closeAgent(callerTerminalId, terminalId) {
            return unwrap(await client.call('close_agent', {callerTerminalId, terminalId}))
        },

        async disconnect() {
            // The HTTP JSON-RPC client is stateless (one fetch per call) — no
            // socket to close. Method retained for interface parity with the
            // prior MCP SDK transport.
        },
    }
}

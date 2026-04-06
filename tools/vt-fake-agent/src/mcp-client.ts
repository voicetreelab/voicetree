import {Client} from '@modelcontextprotocol/sdk/client/index.js'
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js'

export interface McpClient {
  createGraph(callerTerminalId: string, nodes: Array<{filename: string; title: string; summary: string; content?: string; color?: string}>): Promise<unknown>
  spawnAgent(callerTerminalId: string, task: string, parentNodeId: string, opts?: {depthBudget?: number; headless?: boolean}): Promise<{terminalId: string}>
  waitForAgents(callerTerminalId: string, terminalIds: string[], pollIntervalMs?: number): Promise<{monitorId?: string; status: string; terminalIds?: string[]; message?: string}>
  sendMessage(callerTerminalId: string, targetTerminalId: string, message: string): Promise<unknown>
  listAgents(callerTerminalId: string): Promise<Array<{terminalId: string; agentName: string; status: string}>>
  closeAgent(callerTerminalId: string, terminalId: string): Promise<unknown>
  disconnect(): Promise<void>
}

function parseToolResult(result: unknown): unknown {
  const r = result as {isError?: boolean; content?: Array<{type: string; text?: string}>}
  if (r.isError) {
    throw new Error(`MCP tool error: ${JSON.stringify(r.content)}`)
  }
  const textContent = r.content?.find(c => c.type === 'text')
  if (textContent?.text) {
    try { return JSON.parse(textContent.text) } catch { return textContent.text }
  }
  return r.content
}

export async function connectToMcp(port: string): Promise<McpClient> {
  const client = new Client({name: 'vt-fake-agent', version: '1.0.0'})
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`))
  await client.connect(transport)

  return {
    async createGraph(callerTerminalId, nodes) {
      const result = await client.callTool({name: 'create_graph', arguments: {callerTerminalId, nodes}})
      return parseToolResult(result)
    },

    async spawnAgent(callerTerminalId, task, parentNodeId, opts) {
      const args: Record<string, unknown> = {callerTerminalId, task, parentNodeId}
      if (opts?.depthBudget !== undefined) args.depthBudget = opts.depthBudget
      if (opts?.headless !== undefined) args.headless = opts.headless
      const result = await client.callTool({name: 'spawn_agent', arguments: args})
      return parseToolResult(result) as {terminalId: string}
    },

    async waitForAgents(callerTerminalId, terminalIds, pollIntervalMs) {
      const args: Record<string, unknown> = {callerTerminalId, terminalIds}
      if (pollIntervalMs !== undefined) args.pollIntervalMs = pollIntervalMs
      const result = await client.callTool({name: 'wait_for_agents', arguments: args})
      return parseToolResult(result) as {
        monitorId?: string
        status: string
        terminalIds?: string[]
        message?: string
      }
    },

    async sendMessage(callerTerminalId, targetTerminalId, message) {
      // Server schema uses `terminalId` for the target, not `targetTerminalId`
      const result = await client.callTool({
        name: 'send_message',
        arguments: {callerTerminalId, terminalId: targetTerminalId, message}
      })
      return parseToolResult(result)
    },

    async listAgents(_callerTerminalId) {
      // list_agents takes no arguments per server schema
      const result = await client.callTool({name: 'list_agents', arguments: {}})
      return parseToolResult(result) as Array<{terminalId: string; agentName: string; status: string}>
    },

    async closeAgent(callerTerminalId, terminalId) {
      const result = await client.callTool({
        name: 'close_agent',
        arguments: {callerTerminalId, terminalId}
      })
      return parseToolResult(result)
    },

    async disconnect() {
      await client.close()
    }
  }
}

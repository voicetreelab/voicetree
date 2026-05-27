import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'

import { type DebugInstance } from '@vt/graph-tools/debug/protocol/discover'
import { openDebugSession, type DebugSession, type PageLike } from '@vt/graph-tools/debug/protocol/playwrightSession'
import { resolveDebugInstance } from '@vt/graph-tools/debug/protocol/portResolution'
import { err, ok } from '@vt/graph-tools/debug/protocol/Response'
import type { Response } from '@vt/graph-tools/debug/protocol/Response'
import { extractSelectorFlags, registerCommand } from '../index'

type PrettySetupResult = {
  terminalsSpawned: string[]
  nodeCount: number
  projectLoaded?: string
}

type SmokeResult = {
  prettySetup: PrettySetupResult
  fakeAgentTerminal: string
  nodeCreated: boolean
  nodeTitle: string
  mcpPort: number
  cdpPort: number
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function connectMcp(port: number): Promise<Client> {
  const client = new Client({ name: 'vt-debug-smoke', version: '1.0.0' })
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`))
  await client.connect(transport)
  return client
}

function parseMcpText(result: unknown): unknown {
  const r = result as { isError?: boolean; content?: Array<{ type: string; text?: string }> }
  if (r.isError) throw new Error(`MCP error: ${JSON.stringify(r.content)}`)
  const textContent = r.content?.find(c => c.type === 'text')
  if (textContent?.text) {
    try { return JSON.parse(textContent.text) } catch { return textContent.text }
  }
  return r.content
}

async function waitForFakeAgentReady(
  mcpClient: Client,
  terminalId: string,
  timeoutMs: number = 15_000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const result = parseMcpText(
        await mcpClient.callTool({
          name: 'read_terminal_output',
          arguments: { callerTerminalId: terminalId, terminalId },
        }),
      ) as { output?: string }
      if (typeof result === 'object' && result?.output?.includes('REPL mode')) {
        return true
      }
    } catch {
      // MCP not ready yet
    }
    await sleep(1_000)
  }
  return false
}

async function smokeHandler(argv: string[]): Promise<Response<unknown>> {
  const { opts } = extractSelectorFlags(argv)

  const pick = await resolveDebugInstance(opts)
  if (!pick.ok) {
    return err('smoke', pick.message, pick.hint, 2)
  }

  const instance: DebugInstance = pick.instance
  let session: DebugSession | null = null
  let mcpClient: Client | null = null

  try {
    // Step 1: Connect via CDP
    session = await openDebugSession(instance)
    const pages = session.pages
    if (pages.length === 0) {
      return err('smoke', 'CDP connected but no pages found')
    }
    const page: PageLike = pages[0]

    // Step 2: Run prettySetup
    const setupResult = await page.evaluate<PrettySetupResult>(
      'window.electronAPI.main.prettySetupAppForElectronDebugging()',
    )

    if (setupResult.terminalsSpawned.length === 0) {
      return err(
        'smoke',
        'prettySetup spawned no terminals',
        'Ensure "Fake Agent" is in settings.agents with an absolute path to vt-fake-agent/dist/index.js',
      )
    }

    const targetTerminal = setupResult.terminalsSpawned[0]

    // Step 3: Connect to MCP and wait for fake agent REPL
    mcpClient = await connectMcp(instance.mcpPort)

    const ready = await waitForFakeAgentReady(mcpClient, targetTerminal)
    if (!ready) {
      return err(
        'smoke',
        `fake agent ${targetTerminal} did not reach REPL mode within timeout`,
        'Check terminal output with: vt --port ' + instance.mcpPort + ' -t ' + targetTerminal + ' agent output ' + targetTerminal,
      )
    }

    // Step 4: Send create_nodes action
    const nodeTitle = `smoke-test-${Date.now()}`
    const action = JSON.stringify({
      type: 'create_nodes',
      nodes: [{
        title: nodeTitle,
        summary: 'Automated smoke test: fake agent creates a node via MCP.',
        color: 'green',
      }],
    })

    await mcpClient.callTool({
      name: 'send_message',
      arguments: {
        callerTerminalId: targetTerminal,
        terminalId: targetTerminal,
        message: action,
      },
    })

    // Step 5: Wait for node to appear in graph
    await sleep(3_000)

    const graphHasNode = await page.evaluate<boolean>(
      `window.electronAPI.main.getGraph().then(g => Object.values(g.nodes).some(n => n.contentWithoutYamlOrLinks.includes(${JSON.stringify(nodeTitle)})))`,
    )

    if (!graphHasNode) {
      return err('smoke', `node "${nodeTitle}" not found in graph after 3s wait`)
    }

    return ok('smoke', {
      prettySetup: setupResult,
      fakeAgentTerminal: targetTerminal,
      nodeCreated: true,
      nodeTitle,
      mcpPort: instance.mcpPort,
      cdpPort: instance.cdpPort,
    } satisfies SmokeResult)
  } catch (e) {
    return err('smoke', `smoke test failed: ${String(e)}`)
  } finally {
    if (mcpClient) await mcpClient.close().catch(() => undefined)
    if (session) await session.close()
  }
}

registerCommand('smoke', smokeHandler)

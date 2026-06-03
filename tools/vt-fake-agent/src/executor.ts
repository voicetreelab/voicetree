import type { FakeAgentScript, Action } from './types.js'
import type { McpClient } from './mcp-client.js'

type CreateNodeInput = {
  readonly title: string
  readonly summary: string
  readonly content?: string
  readonly color?: string
}

export interface ExecutorEnv {
  terminalId: string
  taskNodePath: string
  canReceiveWaitNotifications?: boolean
  waitForMessage?: (matcher: (message: string) => boolean) => Promise<string>
  /**
   * Optional outputPath forwarded to every create_graph call. When set,
   * the daemon writes new nodes into this directory instead of the project
   * write-path root. Used by the agent-storm perf harness to test the
   * per-directory contention hypothesis (hypotheses.md #10).
   */
  outputDir?: string
}

let createNodeCounter = 0

function interruptibleDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) { resolve(); return }
    const timer = setTimeout(resolve, ms)
    signal.addEventListener('abort', () => { clearTimeout(timer); resolve() }, { once: true })
  })
}

function buildCreateGraphNode(env: ExecutorEnv, node: CreateNodeInput): {
  readonly filename: string
  readonly title: string
  readonly summary: string
  readonly content?: string
  readonly color?: string
} {
  // Include terminalId + a monotonic counter so concurrent fake-agents do not
  // produce colliding filenames when create actions land in the same millisecond.
  const filename = `fake-agent-${env.terminalId}-${Date.now()}-${createNodeCounter++}.md`
  return {
    filename,
    title: node.title,
    summary: node.summary,
    content: node.content,
    color: node.color,
  }
}

export async function executeScript(
  script: FakeAgentScript,
  mcpClient: McpClient,
  env: ExecutorEnv,
  abortController: AbortController,
): Promise<void> {
  const childTerminalIds: string[] = []

  for (const action of script.actions) {
    if (abortController.signal.aborted) break

    console.log(`[fake-agent] Executing: ${action.type}`)

    switch (action.type) {
      case 'delay': {
        await interruptibleDelay(action.ms, abortController.signal)
        break
      }

      case 'create_nodes': {
        await mcpClient.createGraph(
          env.terminalId,
          action.nodes.map((node) => buildCreateGraphNode(env, node)),
          env.outputDir,
          {agentStatus: action.status, statusPhrase: action.statusPhrase},
        )
        break
      }

      case 'spawn_child': {
        let task = action.task
        if (action.childScript) {
          const serialized = JSON.stringify(action.childScript)
          task += `\n### FAKE_AGENT_SCRIPT ###\n${serialized}\n### END_FAKE_AGENT_SCRIPT ###`
        }
        const result = await mcpClient.spawnAgent(
          env.terminalId,
          task,
          env.taskNodePath,
          {
            depthBudget: action.depthBudget,
            // wait_for_children depends on wait_for_agents notifications, so
            // nested manager fake agents must stay interactive by default.
            headless: action.headless ?? false,
          },
        )
        childTerminalIds.push(result.terminalId)
        console.log(`[fake-agent] Spawned child: ${result.terminalId}`)
        break
      }

      case 'wait_for_children': {
        if (childTerminalIds.length === 0) {
          console.log('[fake-agent] No children to wait for')
          break
        }
        console.log(`[fake-agent] Waiting for ${childTerminalIds.length} children: ${childTerminalIds.join(', ')}`)

        if (env.canReceiveWaitNotifications && env.waitForMessage) {
          const waitResult = await mcpClient.waitForAgents(env.terminalId, childTerminalIds, 500)
          console.log(`[fake-agent] wait_for_agents status: ${waitResult.status}`)
          const completionMessage = await env.waitForMessage(
            (message: string) => message.includes('[WaitForAgents] Agent(s) completed.'),
          )
          console.log(`[fake-agent] wait_for_agents completed: ${completionMessage.slice(0, 160)}`)
          break
        }

        console.log('[fake-agent] No PTY notification channel; falling back to headless exit polling')
        // eslint-disable-next-line no-constant-condition
        while (true) {
          if (abortController.signal.aborted) break
          const agents = await mcpClient.listAgents(env.terminalId)
          const childStatuses = childTerminalIds.map((id) => {
            const agent = agents.find((a) => a.terminalId === id)
            return { terminalId: id, status: agent?.status ?? 'unknown' }
          })
          const allDone = childStatuses.every((c) => c.status === 'exited')
          if (allDone) {
            console.log(`[fake-agent] All children done: ${childStatuses.map((c) => `${c.terminalId}=${c.status}`).join(', ')}`)
            break
          }
          await interruptibleDelay(2000, abortController.signal)
        }
        break
      }

      case 'send_message': {
        await mcpClient.sendMessage(
          env.terminalId,
          action.targetTerminalId,
          action.message,
        )
        break
      }

      case 'log': {
        console.log(`[fake-agent] ${action.message}`)
        break
      }

      case 'exit': {
        await mcpClient.disconnect()
        process.exit(action.code ?? 0)
        break // unreachable, for clarity
      }

      default: {
        const _exhaustive: never = action
        console.error(`[fake-agent] Unknown action type: ${(_exhaustive as Action).type}`)
      }
    }
  }
}

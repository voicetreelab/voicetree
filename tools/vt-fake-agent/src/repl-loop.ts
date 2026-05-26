import {executeScript, type ExecutorEnv} from './executor.js'
import type {McpClient} from './mcp-client.js'
import type {MessageInbox} from './message-inbox.js'
import {parseActionMessage} from './prompt-input.js'
import type {Action, FakeAgentScript} from './types.js'

/**
 * Mutable handle on the AbortController shared between the stdin decoder
 * (which calls `abort()` whenever an action arrives mid-delay) and the
 * REPL processor (which installs a fresh controller for each new script).
 * Lets both sides coordinate without leaking the `let currentAbort` from
 * main() outwards.
 */
export type AbortRef = {
  current(): AbortController
  reset(): void
}

export function createAbortRef(): AbortRef {
  let controller = new AbortController()
  return {
    current: () => controller,
    reset: () => { controller = new AbortController() },
  }
}

/**
 * Post-script REPL phase. The initial script has already run; we now poll
 * the inbox and execute any queued action-messages as single-step scripts.
 * Going quiet between messages lets VoiceTree mark isDone=true after the
 * 5s inactivity window. Exits on stdin EOF (after disconnecting the rpc
 * client).
 */
export type ReplLoopConfig = {
  readonly inbox: MessageInbox
  readonly mcpClient: McpClient
  readonly executorEnv: ExecutorEnv
  readonly abortRef: AbortRef
  readonly pollIntervalMs?: number
}

export function startReplLoop(config: ReplLoopConfig): void {
  const pollMs = config.pollIntervalMs ?? 500
  const processQueue = makeQueueProcessor(config)

  const checkInterval = setInterval(() => {
    if (config.inbox.size() > 0) void processQueue()
  }, pollMs)

  process.stdin.on('end', async () => {
    clearInterval(checkInterval)
    await config.mcpClient.disconnect()
    process.exit(0)
  })
}

function makeQueueProcessor(config: ReplLoopConfig): () => Promise<void> {
  return async () => {
    while (config.inbox.size() > 0) {
      const msg = config.inbox.shift()
      if (msg === undefined) return
      await processOneMessage(msg, config)
    }
  }
}

async function processOneMessage(msg: string, config: ReplLoopConfig): Promise<void> {
  const action: Action | null = parseActionMessage(msg)
  if (action === null) {
    console.log(`[fake-agent] Message is not a JSON action, treating as log: ${msg}`)
    return
  }
  console.log(`[fake-agent] Executing message action: ${action.type}`)
  const singleScript: FakeAgentScript = {actions: [action]}
  config.abortRef.reset()
  await executeScript(singleScript, config.mcpClient, config.executorEnv, config.abortRef.current())
}

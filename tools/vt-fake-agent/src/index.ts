import { existsSync, readFileSync } from 'node:fs'
import { connectToMcp } from './mcp-client.js'
import { executeScript } from './executor.js'
import { createCeremonyStdinDecoder } from './stdin-decoder.js'
import { extractScript, type Action, type FakeAgentScript } from './types.js'

/**
 * Phase 6 prompt delivery: AGENT_PROMPT_FILE is authoritative when set.
 * Parent-shell AGENT_PROMPT can leak through OS env-inheritance
 * (electron → tmux server → bash → node) and otherwise mask the file
 * delivery path. Fall back to AGENT_PROMPT only when no file is present.
 */
function resolveAgentPrompt(env: NodeJS.ProcessEnv): string {
  const file = env.AGENT_PROMPT_FILE
  if (file && existsSync(file)) {
    try { return readFileSync(file, 'utf8') } catch { /* fall through to env */ }
  }
  if (env.AGENT_PROMPT && env.AGENT_PROMPT.length > 0) return env.AGENT_PROMPT
  return ''
}

function parseActionMessage(msg: string): Action | null {
  try {
    return JSON.parse(msg) as Action
  } catch {
    const objectStart = msg.indexOf('{')
    const objectEnd = msg.lastIndexOf('}')
    if (objectStart === -1 || objectEnd <= objectStart) return null
    try {
      return JSON.parse(msg.slice(objectStart, objectEnd + 1)) as Action
    } catch {
      return null
    }
  }
}

type MessageMatcher = (message: string) => boolean

type PendingWait = {
  matcher: MessageMatcher
  resolve: (message: string) => void
}

function createMessageInbox() {
  const queued: string[] = []
  const waits: PendingWait[] = []

  return {
    push(message: string) {
      const waitIndex = waits.findIndex(({ matcher }) => matcher(message))
      if (waitIndex !== -1) {
        const [{ resolve }] = waits.splice(waitIndex, 1)
        resolve(message)
        return
      }
      queued.push(message)
    },
    shift() {
      return queued.shift()
    },
    size() {
      return queued.length
    },
    waitFor(matcher: MessageMatcher): Promise<string> {
      const queuedIndex = queued.findIndex((message) => matcher(message))
      if (queuedIndex !== -1) {
        const [message] = queued.splice(queuedIndex, 1)
        return Promise.resolve(message)
      }

      return new Promise<string>((resolve) => {
        waits.push({ matcher, resolve })
      })
    },
  }
}

async function main() {
  const terminalId = process.env.VOICETREE_TERMINAL_ID
  const taskNodePath = process.env.TASK_NODE_PATH ?? ''
  const outputDir = process.env.VOICETREE_OUTPUT_DIR
  const agentPrompt = resolveAgentPrompt(process.env)

  if (!terminalId) { console.error('Missing VOICETREE_TERMINAL_ID'); process.exit(1) }

  console.log(`[fake-agent] Starting: ${terminalId}`)
  // connectToMcp discovers the daemon via @vt/vt-rpc:
  // $VOICETREE_DAEMON_URL + $VOICETREE_VAULT_PATH/.voicetree/auth-token.
  // The spawn parent (buildTerminalEnvVars.ts §5.3) injects both vars.
  const mcpClient = await connectToMcp()

  // Mutable abort ref so the stdin decoder can always interrupt the active delay
  let currentAbort = new AbortController()
  const inbox = createMessageInbox()

  // Parse script from AGENT_PROMPT
  const script = extractScript(agentPrompt)
  console.log(`[fake-agent] Script has ${script.actions.length} actions`)

  // Read PTY stdin as a raw byte stream and decode it with the ceremony
  // decoder. The decoder only emits a message on Alt+Enter (\x1b\r), which
  // mirrors how real coding-agent TUIs (Codex, OpenCode) treat submit and
  // tightly couples the test path to the inject ceremony in
  // packages/systems/agent-runtime/.../send-text-to-terminal.ts. A naive
  // injector that ends with plain Enter (the regression class introduced
  // by commit 6fc41313) will accumulate bytes forever and the surrounding
  // test will time out — exactly the failure signal we want.
  if (process.stdin.isTTY) process.stdin.setRawMode(true)

  const decode = createCeremonyStdinDecoder((message: string) => {
    console.log(`[fake-agent] Received message: ${message.slice(0, 100)}`)
    if (parseActionMessage(message)) {
      // Abort current delay if one is active when a control action arrives.
      currentAbort.abort()
      currentAbort = new AbortController()
    }
    inbox.push(message)
  })
  process.stdin.on('data', (chunk: Buffer) => decode(chunk))

  // Execute initial script
  await executeScript(
    script,
    mcpClient,
    {
      terminalId,
      taskNodePath,
      canReceiveWaitNotifications: process.stdin.isTTY === true,
      waitForMessage: (matcher) => inbox.waitFor(matcher),
      outputDir,
    },
    currentAbort,
  )

  console.log(`[fake-agent] Script complete. Entering REPL mode.`)
  // Now go quiet → VT will mark isDone=true after 5s
  // When a message arrives, process it

  // REPL loop: process queued messages, then wait
  const processMessages = async () => {
    while (inbox.size() > 0) {
      const msg = inbox.shift()!
      const action: Action | null = parseActionMessage(msg)
      if (action) {
        console.log(`[fake-agent] Executing message action: ${action.type}`)
        const singleScript: FakeAgentScript = { actions: [action] }
        currentAbort = new AbortController()
        await executeScript(
          singleScript,
          mcpClient,
          {
            terminalId,
            taskNodePath,
            canReceiveWaitNotifications: process.stdin.isTTY === true,
            waitForMessage: (matcher) => inbox.waitFor(matcher),
            outputDir,
          },
          currentAbort,
        )
      } else {
        console.log(`[fake-agent] Message is not a JSON action, treating as log: ${msg}`)
      }
    }
    // Go quiet again → isDone=true after 5s inactivity
  }

  // Check for messages periodically (stdin 'data' events fire asynchronously)
  const checkInterval = setInterval(async () => {
    if (inbox.size() > 0) await processMessages()
  }, 500)

  // Clean exit on stdin EOF.
  process.stdin.on('end', async () => {
    clearInterval(checkInterval)
    await mcpClient.disconnect()
    process.exit(0)
  })
}

main().catch(err => { console.error('[fake-agent] Fatal:', err); process.exit(1) })

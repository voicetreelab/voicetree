import { createInterface } from 'readline'
import { connectToMcp } from './mcp-client.js'
import { executeScript } from './executor.js'
import { extractScript, type Action, type FakeAgentScript } from './types.js'

/** Strip ANSI escape sequences that sendTextToTerminal may inject via PTY */
function stripAnsi(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*[a-zA-Z]|\x1b[^[[]?|\x00|\x15/g, '')
}

async function main() {
  const terminalId = process.env.VOICETREE_TERMINAL_ID
  const mcpPort = process.env.VOICETREE_MCP_PORT ?? '3001'
  const taskNodePath = process.env.TASK_NODE_PATH ?? ''
  const agentPrompt = process.env.AGENT_PROMPT ?? ''

  if (!terminalId) { console.error('Missing VOICETREE_TERMINAL_ID'); process.exit(1) }

  console.log(`[fake-agent] Starting: ${terminalId}`)
  console.log(`[fake-agent] Connecting to MCP on port ${mcpPort}`)

  const mcpClient = await connectToMcp(mcpPort)

  // Mutable abort ref so readline handler can always interrupt the active delay
  let currentAbort = new AbortController()

  // Parse script from AGENT_PROMPT
  const script = extractScript(agentPrompt)
  console.log(`[fake-agent] Script has ${script.actions.length} actions`)

  // Set up readline for incoming messages (from send_message via PTY stdin)
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: false })

  // Message queue: incoming messages are queued and processed after current action
  const messageQueue: string[] = []
  rl.on('line', (raw: string) => {
    const trimmed = stripAnsi(raw).trim()
    if (!trimmed) return
    console.log(`[fake-agent] Received message: ${trimmed.slice(0, 100)}`)
    // Abort current delay if one is active
    currentAbort.abort()
    currentAbort = new AbortController()
    messageQueue.push(trimmed)
  })

  // Execute initial script
  await executeScript(script, mcpClient, { terminalId, taskNodePath }, currentAbort)

  console.log(`[fake-agent] Script complete. Entering REPL mode.`)
  // Now go quiet → VT will mark isDone=true after 5s
  // When a message arrives, process it

  // REPL loop: process queued messages, then wait
  const processMessages = async () => {
    while (messageQueue.length > 0) {
      const msg = messageQueue.shift()!
      try {
        const action: Action = JSON.parse(msg)
        console.log(`[fake-agent] Executing message action: ${action.type}`)
        const singleScript: FakeAgentScript = { actions: [action] }
        currentAbort = new AbortController()
        await executeScript(singleScript, mcpClient, { terminalId, taskNodePath }, currentAbort)
      } catch {
        console.log(`[fake-agent] Message is not a JSON action, treating as log: ${msg}`)
      }
    }
    // Go quiet again → isDone=true after 5s inactivity
  }

  // Check for messages periodically (readline events fire asynchronously)
  const checkInterval = setInterval(async () => {
    if (messageQueue.length > 0) await processMessages()
  }, 500)

  // Clean exit on stdin close
  rl.on('close', async () => {
    clearInterval(checkInterval)
    await mcpClient.disconnect()
    process.exit(0)
  })
}

main().catch(err => { console.error('[fake-agent] Fatal:', err); process.exit(1) })

import {connectToMcp} from './mcp-client.js'
import {executeScript, type ExecutorEnv} from './executor.js'
import {createCeremonyStdinDecoder} from './stdin-decoder.js'
import {createMessageInbox, type MessageInbox} from './message-inbox.js'
import {parseActionMessage, resolveAgentPrompt} from './prompt-input.js'
import {createAbortRef, startReplLoop, type AbortRef} from './repl-loop.js'
import {extractScript} from './types.js'

type RequiredEnv = {
  readonly terminalId: string
  readonly taskNodePath: string
  readonly outputDir: string | undefined
  readonly agentPrompt: string
}

function resolveEnv(env: NodeJS.ProcessEnv): RequiredEnv {
  const terminalId = env.VOICETREE_TERMINAL_ID
  if (!terminalId) {
    console.error('Missing VOICETREE_TERMINAL_ID')
    process.exit(1)
  }
  return {
    terminalId,
    taskNodePath: env.TASK_NODE_PATH ?? '',
    outputDir: env.VOICETREE_OUTPUT_DIR,
    agentPrompt: resolveAgentPrompt(env),
  }
}

function buildExecutorEnv(env: RequiredEnv, inbox: MessageInbox): ExecutorEnv {
  return {
    terminalId: env.terminalId,
    taskNodePath: env.taskNodePath,
    canReceiveWaitNotifications: process.stdin.isTTY === true,
    waitForMessage: (matcher) => inbox.waitFor(matcher),
    outputDir: env.outputDir,
  }
}

/**
 * Wires stdin → ceremony decoder → inbox. The decoder only emits a message
 * on Alt+Enter (\x1b\r), which mirrors how real coding-agent TUIs (Codex,
 * OpenCode) treat submit and tightly couples the test path to the inject
 * ceremony in send-text-to-terminal.ts. A naive injector that ends with
 * plain Enter (the regression class introduced by commit 6fc41313) will
 * accumulate bytes forever and the surrounding test will time out —
 * exactly the failure signal we want.
 *
 * When an action message arrives mid-delay, the active AbortController is
 * aborted so the executor can interrupt its in-flight setTimeout. A fresh
 * controller is installed so subsequent work has a clean signal.
 */
function wireStdinToInbox(inbox: MessageInbox, abortRef: AbortRef): void {
  if (process.stdin.isTTY) process.stdin.setRawMode(true)
  const decode = createCeremonyStdinDecoder((message) => {
    console.log(`[fake-agent] Received message: ${message.slice(0, 100)}`)
    if (parseActionMessage(message)) {
      abortRef.current().abort()
      abortRef.reset()
    }
    inbox.push(message)
  })
  process.stdin.on('data', (chunk: Buffer) => decode(chunk))
}

async function main(): Promise<void> {
  const env = resolveEnv(process.env)
  console.log(`[fake-agent] Starting: ${env.terminalId}`)

  // connectToMcp discovers the daemon via @vt/vt-rpc:
  // $VOICETREE_DAEMON_URL + $VOICETREE_PROJECT_PATH/.voicetree/auth-token.
  // The spawn parent (buildTerminalEnvVars.ts §5.3) injects both vars.
  const mcpClient = await connectToMcp()
  const inbox = createMessageInbox()
  const abortRef = createAbortRef()
  wireStdinToInbox(inbox, abortRef)

  const script = extractScript(env.agentPrompt)
  console.log(`[fake-agent] Script has ${script.actions.length} actions`)
  const executorEnv = buildExecutorEnv(env, inbox)

  await executeScript(script, mcpClient, executorEnv, abortRef.current())

  console.log(`[fake-agent] Script complete. Entering REPL mode.`)
  startReplLoop({inbox, mcpClient, executorEnv, abortRef})
}

main().catch(err => { console.error('[fake-agent] Fatal:', err); process.exit(1) })

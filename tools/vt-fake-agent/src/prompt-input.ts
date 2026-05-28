import {existsSync, readFileSync} from 'node:fs'
import type {Action} from './types.js'

/**
 * Phase 6 prompt delivery: AGENT_PROMPT_FILE is authoritative when set.
 * Parent-shell AGENT_PROMPT can leak through OS env-inheritance
 * (electron → tmux server → bash → node) and otherwise mask the file
 * delivery path. Fall back to AGENT_PROMPT only when no file is present.
 */
export function resolveAgentPrompt(env: NodeJS.ProcessEnv): string {
  const file = env.AGENT_PROMPT_FILE
  if (file && existsSync(file)) {
    try { return readFileSync(file, 'utf8') } catch { /* fall through to env */ }
  }
  if (env.AGENT_PROMPT && env.AGENT_PROMPT.length > 0) return env.AGENT_PROMPT
  return ''
}

/**
 * Best-effort decode of an inbound REPL message into an Action. Accepts
 * either a clean JSON payload or one wrapped in surrounding chatter — the
 * latter shape mirrors how send_message bodies sometimes arrive from a
 * peer agent that prefixed/suffixed its tool-call output. Returns null
 * when no recognisable Action JSON can be recovered.
 */
export function parseActionMessage(msg: string): Action | null {
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

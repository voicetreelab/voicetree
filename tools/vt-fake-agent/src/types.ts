/**
 * Agent-authored status preset. Mirrors `@vt/vt-daemon-protocol`'s
 * `AGENT_STATUSES` vocabulary — kept local so this test harness stays
 * dependency-light; the daemon validates the value on receipt.
 */
export type AgentStatus = 'working' | 'awaiting_input' | 'done' | 'failed'

export type Action =
  | { type: 'delay'; ms: number }
  | {
      type: 'create_nodes'
      nodes: readonly { title: string; summary: string; content?: string; color?: string }[]
      // Optional agent-authored status reported with this progress node — drives
      // the terminal's lifecycle icon (`status`) and the live status phrase shown
      // next to the model name (`statusPhrase`).
      status?: AgentStatus
      statusPhrase?: string
    }
  | { type: 'spawn_child'; task: string; childScript?: FakeAgentScript; depthBudget?: number; headless?: boolean }
  | { type: 'wait_for_children' }
  | { type: 'send_message'; targetTerminalId: string; message: string }
  | { type: 'log'; message: string }
  | { type: 'exit'; code?: number }

export type FakeAgentScript = {
  readonly actions: readonly Action[]
}

export const SCRIPT_START_MARKER = '### FAKE_AGENT_SCRIPT ###'
export const SCRIPT_END_MARKER = '### END_FAKE_AGENT_SCRIPT ###'

/**
 * Extracts a FakeAgentScript from a prompt string.
 * Looks for content between SCRIPT_START_MARKER and SCRIPT_END_MARKER.
 * Falls back to parsing the entire string as JSON.
 */
export function extractScript(prompt: string): FakeAgentScript {
  const startIdx = prompt.indexOf(SCRIPT_START_MARKER)
  const endIdx = prompt.indexOf(SCRIPT_END_MARKER)

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const json = prompt.slice(startIdx + SCRIPT_START_MARKER.length, endIdx).trim()
    const parsed = JSON.parse(json) as FakeAgentScript
    if (!parsed.actions || !Array.isArray(parsed.actions)) {
      throw new Error('Invalid FakeAgentScript: missing actions array')
    }
    return parsed
  }

  try {
    const parsed = JSON.parse(prompt.trim()) as FakeAgentScript
    if (parsed.actions && Array.isArray(parsed.actions)) {
      return parsed
    }
  } catch {
    // Prompt is not JSON — fall through to default empty script
  }

  return { actions: [] }
}

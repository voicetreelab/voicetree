export type Action =
  | { type: 'delay'; ms: number }
  | { type: 'create_node'; title: string; summary: string; content?: string; color?: string }
  | { type: 'spawn_child'; task: string; childScript?: FakeAgentScript; depthBudget?: number }
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

  let json: string
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    json = prompt.slice(startIdx + SCRIPT_START_MARKER.length, endIdx).trim()
  } else {
    json = prompt.trim()
  }

  const parsed = JSON.parse(json) as FakeAgentScript
  if (!parsed.actions || !Array.isArray(parsed.actions)) {
    throw new Error('Invalid FakeAgentScript: missing actions array')
  }
  return parsed
}

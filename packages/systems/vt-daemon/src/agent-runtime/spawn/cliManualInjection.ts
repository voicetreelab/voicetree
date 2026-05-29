/**
 * Spawn-time injection of the canonical `vt` CLI manual into each
 * agent's AGENT_PROMPT.
 *
 * External coding agents discover the VoiceTree tools by reading the
 * manual section spawning splices into their AGENT_PROMPT. The manual
 * is rendered live from `TOOL_SPECS` in `@vt/vt-daemon-protocol` — no
 * filesystem read, no markdown parsing — so any change to the canonical
 * spec data lands in newly spawned agents on the next spawn.
 *
 * Design points:
 * - The essentials slice is injected by default (`tier: 'essentials'`),
 *   keeping the AGENT_PROMPT compact. Full reference is discoverable
 *   via `vt manual <verb>`.
 * - The injected content is delimited by sentinels so a reader can tell
 *   where the user's prompt ends and the manual begins.
 * - The function is idempotent: a second call with the same env-vars
 *   map returns the input unchanged (the sentinel scan short-circuits).
 */

import {renderManual, TOOL_SPECS} from '@vt/vt-daemon-protocol'

const SECTION_HEADER: string = '<vt_cli_manual>'
const SECTION_FOOTER: string = '</vt_cli_manual>'

/**
 * Pure: returns a new env-var map with the essentials slice of the
 * CLI manual appended to `AGENT_PROMPT`. Idempotent — calling twice
 * does not nest the section.
 */
export function appendCliManualToAgentPrompt(
    envVars: Record<string, string>,
): Record<string, string> {
    const current: string = envVars.AGENT_PROMPT ?? ''
    if (current.includes(SECTION_HEADER)) return envVars

    const body: string = renderManual(TOOL_SPECS, {tier: 'essentials'}).trimEnd()
    if (body.length === 0) return envVars

    const block: string = `\n\n${SECTION_HEADER}\n${body}\n${SECTION_FOOTER}\n`
    return {...envVars, AGENT_PROMPT: current + block}
}

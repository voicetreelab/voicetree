/**
 * Spawn-time injection of the canonical `vt` CLI manual into each agent's
 * AGENT_PROMPT.
 *
 * Step 7 deletes VoiceTree's MCP server. External coding agents no longer
 * discover VoiceTree tools through an `.mcp.json` entry — they learn the
 * `vt` CLI verbs by reading the manual that lives at
 * `packages/systems/voicetree-cli/prompts/cli-manual.md`. The spawn pipeline calls
 * `appendCliManualToAgentPrompt` to splice the manual into the agent's
 * system prompt before exec.
 *
 * Design points:
 * - The manual path is supplied by the runtime env (`getCliManualPath`). Each
 *   shell (Electron, vt-mcpd, test rig) wires its own location.
 * - File I/O failures are non-fatal — if the file cannot be read the env vars
 *   pass through unchanged. The spawn proceeds without CLI discovery.
 * - The injected content is delimited by sentinels so a reader can tell
 *   where the user's prompt ends and the manual begins.
 */

import {promises as fs} from 'node:fs'
import {getRuntimeEnv} from '../../runtime/runtime-config'

const SECTION_HEADER: string = '<vt_cli_manual>'
const SECTION_FOOTER: string = '</vt_cli_manual>'
const ESSENTIALS_BEGIN: string = '<!-- BEGIN_ESSENTIALS -->'
const ESSENTIALS_END: string = '<!-- END_ESSENTIALS -->'

/**
 * Pure: extract the Essentials block from a tiered manual. Returns the
 * substring between the BEGIN/END marker comments (exclusive of markers).
 * Returns null when either marker is missing — callers fall back to the
 * full manual in that case so the function stays safe with non-tiered
 * inputs.
 */
function extractEssentials(manualContent: string): string | null {
    const beginIdx: number = manualContent.indexOf(ESSENTIALS_BEGIN)
    if (beginIdx === -1) return null
    const afterBegin: number = beginIdx + ESSENTIALS_BEGIN.length
    const endIdx: number = manualContent.indexOf(ESSENTIALS_END, afterBegin)
    if (endIdx === -1) return null
    return manualContent.slice(afterBegin, endIdx).trim()
}

/**
 * Pure: returns a new env-var map with the CLI manual appended to
 * `AGENT_PROMPT`. If the manual is empty or absent the input is returned
 * unchanged. Idempotent — calling twice does not nest the section.
 *
 * When the manual carries `<!-- BEGIN_ESSENTIALS -->` / `<!-- END_ESSENTIALS -->`
 * markers, only the Essentials block is injected — the full Reference is
 * discoverable via `vt manual <verb>`. Manuals without markers fall through
 * to full-content injection (preserves behavior for callers that pass a
 * non-tiered manual).
 */
export function appendCliManualToAgentPrompt(
    envVars: Record<string, string>,
    manualContent: string | null,
): Record<string, string> {
    if (manualContent === null || manualContent.trim().length === 0) return envVars
    const current: string = envVars.AGENT_PROMPT ?? ''
    if (current.includes(SECTION_HEADER)) return envVars
    const essentials: string | null = extractEssentials(manualContent)
    const body: string = (essentials ?? manualContent).trimEnd()
    const block: string = `\n\n${SECTION_HEADER}\n${body}\n${SECTION_FOOTER}\n`
    return {...envVars, AGENT_PROMPT: current + block}
}

/**
 * Read the CLI manual via the configured runtime env. Returns null on any
 * I/O failure or if the env did not register a path.
 */
export async function readCliManualOrNull(): Promise<string | null> {
    const manualPath: string | null = getRuntimeEnv().getCliManualPath?.() ?? null
    if (!manualPath) return null
    try {
        return await fs.readFile(manualPath, 'utf-8')
    } catch {
        return null
    }
}

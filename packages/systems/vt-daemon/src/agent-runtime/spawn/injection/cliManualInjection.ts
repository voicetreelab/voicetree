/**
 * Spawn-time `vt` CLI discovery for AGENT_PROMPT.
 *
 * The default prompt templates already include a concise <VT_CLI> block.
 * Custom prompts may omit it, so spawning appends a short progressive-
 * retrieval pointer instead of copying rendered manual sections into every
 * spawned agent prompt.
 */

import {TOOL_SPECS, type ToolSpec} from '@vt/vt-daemon-protocol'

const SECTION_HEADER: string = '<VT_CLI>'
const SECTION_FOOTER: string = '</VT_CLI>'
const LEGACY_MANUAL_HEADER: string = '<vt_cli_manual>'

/**
 * Pure: returns a new env-var map with a concise CLI discovery block
 * appended to `AGENT_PROMPT` when one is not already present.
 */
export function appendCliDiscoveryToAgentPrompt(
    envVars: Record<string, string>,
): Record<string, string> {
    const current: string = envVars.AGENT_PROMPT ?? ''
    if (current.includes(SECTION_HEADER) || current.includes(LEGACY_MANUAL_HEADER)) return envVars

    const body: string = renderAgentCliDiscovery()
    if (body.length === 0) return envVars

    const block: string = `\n\n${SECTION_HEADER}\n${body}\n${SECTION_FOOTER}\n`
    return {...envVars, AGENT_PROMPT: current + block}
}

function renderAgentCliDiscovery(): string {
    const essentials: string = TOOL_SPECS
        .filter((spec: ToolSpec): boolean => spec.tier === 'essentials')
        .map((spec: ToolSpec): string => `- \`${spec.cliVerb}\`: ${spec.summary}`)
        .join('\n')

    return [
        'Voicetree operations are exposed as the `vt` CLI (available on PATH).',
        'Use `vt manual` for the full reference or `vt manual <verb>` for one tool section.',
        'Common verbs:',
        essentials,
    ].join('\n').trimEnd()
}

/**
 * Vault-open advertisement of the `vt` CLI for user-launched coding agents.
 *
 * Background: spawn-time prompt injection reaches only agents that
 * VoiceTree itself spawns. A user who opens Claude Code (or Codex,
 * OpenCode, …) directly in their vault never sees the manual
 * injection. Before Step 7 those user-launched agents discovered the
 * VoiceTree tools through the auto-written `.mcp.json` entry; after
 * Step 7 there is no MCP entry, so the agent has no discovery surface.
 *
 * Mitigation (recommended by Step 7 design §7 R1):
 *   - If `<vault>/CLAUDE.md` exists, append (or replace) a fenced
 *     VoiceTree section advertising the `vt` CLI. Idempotent: the
 *     section is delimited by sentinels so subsequent vault opens
 *     overwrite the existing block rather than nesting.
 *   - Otherwise, write `<vault>/.voicetree/AGENTS.md` containing the
 *     same content. Agent runtimes that consume `AGENTS.md` (Codex,
 *     OpenCode) pick it up on session start.
 *
 * The manual content is rendered live from `@vt/vt-daemon-protocol`'s
 * `TOOL_SPECS` — no on-disk manual file, no filesystem read. Whatever
 * the canonical spec data says becomes the contents written into
 * CLAUDE.md / AGENTS.md the next time the vault is opened.
 */

import {promises as fs} from 'fs'
import path from 'path'
import {renderManual, TOOL_SPECS} from '@vt/vt-daemon-protocol'

const SECTION_START: string = '<!-- VOICETREE_AGENT_DISCOVERY_START -->'
const SECTION_END: string = '<!-- VOICETREE_AGENT_DISCOVERY_END -->'
const SECTION_BANNER: string =
    '## VoiceTree `vt` CLI (auto-generated — do not edit between sentinels)'

/**
 * Build the fenced VoiceTree section ready for splicing into a
 * CLAUDE.md / AGENTS.md file. The output is delimited by stable
 * sentinels so subsequent runs can find and replace the block in
 * place. Pure.
 */
export function buildVoicetreeDiscoverySection(manualContent: string): string {
    return `${SECTION_START}\n${SECTION_BANNER}\n\n${manualContent.trimEnd()}\n${SECTION_END}\n`
}

/**
 * Given the current contents of a CLAUDE.md / AGENTS.md file (or null
 * if it doesn't yet exist), return the new contents with the
 * VoiceTree section present exactly once. Pure: idempotent across
 * repeated calls.
 */
export function spliceVoicetreeDiscoverySection(
    existingContent: string | null,
    manualContent: string,
): string {
    const newSection: string = buildVoicetreeDiscoverySection(manualContent)
    if (existingContent === null || existingContent.length === 0) return newSection

    const startIndex: number = existingContent.indexOf(SECTION_START)
    const endIndex: number = existingContent.indexOf(SECTION_END)
    if (startIndex !== -1 && endIndex !== -1 && endIndex > startIndex) {
        const before: string = existingContent.slice(0, startIndex)
        const afterEnd: number = endIndex + SECTION_END.length
        const after: string = existingContent.slice(afterEnd).replace(/^\n+/, '')
        return `${before}${newSection}${after.length > 0 ? after : ''}`.trimEnd() + '\n'
    }

    const separator: string = existingContent.endsWith('\n') ? '\n' : '\n\n'
    return `${existingContent}${separator}${newSection}`
}

async function readFileOrNull(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, 'utf-8')
    } catch {
        return null
    }
}

/**
 * Write or update the VoiceTree CLI discovery file inside `vaultDir`.
 *
 * Strategy:
 *   - If `<vaultDir>/CLAUDE.md` exists, append / replace the VoiceTree
 *     section there. Other content in the file is left intact.
 *   - Otherwise, write `<vaultDir>/.voicetree/AGENTS.md` with the
 *     section as its body (creating the `.voicetree/` directory if
 *     needed).
 *
 * The manual content is rendered from `TOOL_SPECS`; pass `specs` to
 * inject a different (e.g. test) spec set. Errors writing the target
 * file are swallowed — vault open must not depend on this side effect
 * succeeding.
 */
export async function writeVaultAgentDiscoveryFile(
    vaultDir: string,
    specs: typeof TOOL_SPECS = TOOL_SPECS,
): Promise<void> {
    const manualContent: string = renderManual(specs).trimEnd()
    if (manualContent.length === 0) return

    const claudeMdPath: string = path.join(vaultDir, 'CLAUDE.md')
    const existingClaudeMd: string | null = await readFileOrNull(claudeMdPath)

    if (existingClaudeMd !== null) {
        const next: string = spliceVoicetreeDiscoverySection(existingClaudeMd, manualContent)
        if (next !== existingClaudeMd) {
            await fs.writeFile(claudeMdPath, next, 'utf-8').catch(() => undefined)
        }
        return
    }

    const dotVoicetreeDir: string = path.join(vaultDir, '.voicetree')
    const agentsMdPath: string = path.join(dotVoicetreeDir, 'AGENTS.md')
    const existingAgentsMd: string | null = await readFileOrNull(agentsMdPath)
    const next: string = spliceVoicetreeDiscoverySection(existingAgentsMd, manualContent)
    if (next === existingAgentsMd) return
    await fs.mkdir(dotVoicetreeDir, {recursive: true}).catch(() => undefined)
    await fs.writeFile(agentsMdPath, next, 'utf-8').catch(() => undefined)
}

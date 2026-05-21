/**
 * Stale-entry migrator for external MCP-client config files.
 *
 * VoiceTree no longer presents itself as an MCP server (Step 7). Discovery is
 * now delivered as a spawn-time prompt injection of `tools/prompts/cli-manual.md`.
 * Existing user vaults may still contain a `voicetree` entry inside one of the
 * legacy MCP-client config files — that entry would point at an HTTP port that
 * no longer binds, surfacing as a confusing connect failure on the agent side.
 *
 * `stripStaleVoicetreeMcpEntries` is called once when VoiceTree loads a vault.
 * For each known config file it opens the file (if present), removes any
 * `voicetree` entry, and writes the rest back untouched. Other MCP entries
 * (Linear, etc.) are preserved. Idempotent: running on a clean file is a
 * no-op.
 */

import {promises as fs} from 'fs'
import path from 'path'

const VOICETREE_MCP_SERVER_NAME: 'voicetree' = 'voicetree' as const

/** Matches the [mcp_servers.voicetree] section and all its key-value lines. */
const CODEX_VOICETREE_SECTION_RE: RegExp = /\[mcp_servers\.voicetree\]\s*\n(?:(?!\[)[^\n]*\n?)*/

async function readFileOrNull(filePath: string): Promise<string | null> {
    try {
        return await fs.readFile(filePath, 'utf-8')
    } catch {
        return null
    }
}

async function stripFromMcpJsonShape(filePath: string): Promise<void> {
    const content: string | null = await readFileOrNull(filePath)
    if (content === null) return

    let parsed: {mcpServers?: Record<string, unknown>} & Record<string, unknown>
    try {
        parsed = JSON.parse(content)
    } catch {
        return
    }
    if (!parsed.mcpServers || parsed.mcpServers[VOICETREE_MCP_SERVER_NAME] === undefined) return

    delete parsed.mcpServers[VOICETREE_MCP_SERVER_NAME]
    if (Object.keys(parsed.mcpServers).length === 0) delete parsed.mcpServers
    await fs.writeFile(filePath, JSON.stringify(parsed, null, 2), 'utf-8')
}

async function stripFromOpencodeJsonc(filePath: string): Promise<void> {
    const content: string | null = await readFileOrNull(filePath)
    if (content === null) return

    let parsed: {mcp?: Record<string, unknown>} & Record<string, unknown>
    try {
        parsed = JSON.parse(content)
    } catch {
        return
    }
    if (!parsed.mcp || parsed.mcp[VOICETREE_MCP_SERVER_NAME] === undefined) return

    delete parsed.mcp[VOICETREE_MCP_SERVER_NAME]
    if (Object.keys(parsed.mcp).length === 0) delete parsed.mcp
    await fs.writeFile(filePath, JSON.stringify(parsed, null, 2), 'utf-8')
}

async function stripFromCodexToml(filePath: string): Promise<void> {
    const content: string | null = await readFileOrNull(filePath)
    if (content === null || !content.includes('[mcp_servers.voicetree]')) return

    const stripped: string = content
        .replace(CODEX_VOICETREE_SECTION_RE, '')
        .replace(/\n{3,}/g, '\n\n')
        .trimEnd()
    if (stripped.length === 0) {
        await fs.unlink(filePath).catch(() => undefined)
        return
    }
    await fs.writeFile(filePath, stripped + '\n', 'utf-8')
}

/**
 * Remove any `voicetree` MCP entry from external coding-agent config files
 * inside `directory`. Preserves unrelated entries. Idempotent.
 *
 * Targets:
 *   - `<directory>/.mcp.json`            (Claude Code)
 *   - `<directory>/opencode.jsonc`       (OpenCode)
 *   - `<directory>/.codex/config.toml`   (Codex)
 */
export async function stripStaleVoicetreeMcpEntries(directory: string): Promise<void> {
    await Promise.all([
        stripFromMcpJsonShape(path.join(directory, '.mcp.json')),
        stripFromOpencodeJsonc(path.join(directory, 'opencode.jsonc')),
        stripFromCodexToml(path.join(directory, '.codex', 'config.toml')),
    ])
}

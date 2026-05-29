/**
 * Stale-entry migrator for external MCP-client config files.
 *
 * VoiceTree no longer presents itself as an MCP server (Step 7). Discovery is
 * now delivered as a spawn-time prompt injection of the CLI manual,
 * rendered live from `@vt/vt-daemon-protocol`'s `TOOL_SPECS`.
 * Existing user vaults may still contain a `voicetree` entry inside one of the
 * legacy MCP-client config files — that entry would point at an HTTP port that
 * no longer binds, surfacing as a confusing connect failure on the agent side.
 *
 * `stripStaleVoicetreeMcpEntries` is called once when VoiceTree loads a vault.
 * It walks from the vault directory up to a boundary ancestor (default: the
 * user's home directory, inclusive) and at each level removes any `voicetree`
 * entry from the known config files. Other MCP entries (Linear, etc.) are
 * preserved. Idempotent: running on a clean file is a no-op.
 *
 * Walking parents is necessary because Claude Code's `.mcp.json` discovery
 * climbs ancestor directories: a stale entry in a grandparent leaks into every
 * new vault rooted below it.
 */

import {promises as fs} from 'fs'
import os from 'os'
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

// Walk from `start` up to and including `stopAtAncestor`. If `start` is not
// nested inside `stopAtAncestor`, fall back to a single-directory list so the
// migrator can't accidentally scan unrelated filesystem branches.
function ancestorsUpTo(start: string, stopAtAncestor: string): readonly string[] {
    const startAbs: string = path.resolve(start)
    const boundaryAbs: string = path.resolve(stopAtAncestor)
    const rel: string = path.relative(boundaryAbs, startAbs)
    const insideBoundary: boolean = rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
    if (!insideBoundary) return [startAbs]

    const dirs: string[] = []
    let current: string = startAbs
    while (true) {
        dirs.push(current)
        if (current === boundaryAbs) break
        const parent: string = path.dirname(current)
        if (parent === current) break
        current = parent
    }
    return dirs
}

/**
 * Remove any `voicetree` MCP entry from external coding-agent config files
 * across the walk from `directory` up to `options.stopAtAncestor` (inclusive,
 * default: `os.homedir()`). Preserves unrelated entries. Idempotent.
 *
 * Targets per directory level:
 *   - `<dir>/.mcp.json`            (Claude Code)
 *   - `<dir>/opencode.jsonc`       (OpenCode)
 *   - `<dir>/.codex/config.toml`   (Codex)
 *
 * If `directory` is not nested inside `stopAtAncestor`, only `directory`
 * itself is scanned.
 */
export async function stripStaleVoicetreeMcpEntries(
    directory: string,
    options?: {readonly stopAtAncestor?: string},
): Promise<void> {
    const boundary: string = options?.stopAtAncestor ?? os.homedir()
    const dirs: readonly string[] = ancestorsUpTo(directory, boundary)
    await Promise.all(
        dirs.flatMap((dir: string): readonly Promise<void>[] => [
            stripFromMcpJsonShape(path.join(dir, '.mcp.json')),
            stripFromOpencodeJsonc(path.join(dir, 'opencode.jsonc')),
            stripFromCodexToml(path.join(dir, '.codex', 'config.toml')),
        ]),
    )
}

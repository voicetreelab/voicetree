/**
 * Edge helper: sync MCP client config files inside a spawn directory so the
 * agent launched there connects to the live VoiceTree MCP port.
 *
 * Background: when an agent spawns in a worktree (e.g. `vt-wts/<branch>`),
 * the worktree's `.mcp.json` / `.codex/config.toml` are inherited from a
 * previous checkout or a previous VoiceTree instance and can carry a stale
 * port. Both Claude Code and Codex read those files relative to cwd, so the
 * stale port wins unless we refresh the file at spawn time.
 *
 * Writes:
 *   - `<spawnDir>/.mcp.json`       (always — Claude/other agents read this)
 *   - `<spawnDir>/.codex/config.toml` (only when agentCommand is codex)
 *   - `<spawnDir>/.gemini/settings.json` (only when agentCommand is gemini)
 *
 * Idempotent: same-content writes are skipped. Existing servers / sections
 * unrelated to `voicetree` are preserved.
 */

import * as fsPromises from 'node:fs/promises'
import * as path from 'node:path'

const VOICETREE_MCP_SERVER_NAME: 'voicetree' = 'voicetree' as const

/** Matches the `[mcp_servers.voicetree]` section and its key=value lines. */
const CODEX_VOICETREE_SECTION_RE: RegExp = /\[mcp_servers\.voicetree\]\s*\n(?:(?!\[)[^\n]*\n?)*/

type McpServerEntry = {readonly type: string; readonly url: string}

type McpJsonConfig = {
    mcpServers?: Record<string, McpServerEntry>
}

export type WorktreeMcpConfigSyncDeps = {
    readonly mkdir: (dir: string) => Promise<void>
    readonly readFile: (filePath: string) => Promise<string | null>
    readonly writeFile: (filePath: string, content: string) => Promise<void>
}

async function readFileOrNull(filePath: string): Promise<string | null> {
    try {
        return await fsPromises.readFile(filePath, 'utf8')
    } catch {
        return null
    }
}

const defaultDeps: WorktreeMcpConfigSyncDeps = {
    mkdir: async (dir: string): Promise<void> => {
        await fsPromises.mkdir(dir, {recursive: true})
    },
    readFile: readFileOrNull,
    writeFile: async (filePath: string, content: string): Promise<void> => {
        await fsPromises.writeFile(filePath, content, 'utf8')
    },
}

function isCodexAgent(agentCommand: string): boolean {
    return agentCommand.toLowerCase().includes('codex')
}

function isGeminiAgent(agentCommand: string): boolean {
    return agentCommand.toLowerCase().includes('gemini')
}

function buildMcpJson(existing: string | null, mcpPort: number): string {
    let parsed: McpJsonConfig = {}
    if (existing !== null) {
        try {
            parsed = JSON.parse(existing) as McpJsonConfig
        } catch {
            parsed = {}
        }
    }
    parsed.mcpServers = {
        ...(parsed.mcpServers ?? {}),
        [VOICETREE_MCP_SERVER_NAME]: {
            type: 'http',
            url: `http://127.0.0.1:${mcpPort}/mcp`,
        },
    }
    return JSON.stringify(parsed, null, 2)
}

function buildCodexToml(existing: string, mcpPort: number): string {
    const section: string = `[mcp_servers.voicetree]\nurl = "http://localhost:${mcpPort}/mcp"\n`
    if (existing.includes('[mcp_servers.voicetree]')) {
        return existing.replace(CODEX_VOICETREE_SECTION_RE, section)
    }
    return existing.trimEnd() + (existing.length > 0 ? '\n\n' : '') + section
}

async function syncMcpJson(
    spawnDirectory: string,
    mcpPort: number,
    deps: WorktreeMcpConfigSyncDeps,
): Promise<void> {
    const mcpJsonPath: string = path.join(spawnDirectory, '.mcp.json')
    const existing: string | null = await deps.readFile(mcpJsonPath)
    const next: string = buildMcpJson(existing, mcpPort)
    if (existing === next) return
    await deps.mkdir(spawnDirectory)
    await deps.writeFile(mcpJsonPath, next)
}

async function syncCodexToml(
    spawnDirectory: string,
    mcpPort: number,
    deps: WorktreeMcpConfigSyncDeps,
): Promise<void> {
    const codexDir: string = path.join(spawnDirectory, '.codex')
    const codexPath: string = path.join(codexDir, 'config.toml')
    const existing: string = (await deps.readFile(codexPath)) ?? ''
    const next: string = buildCodexToml(existing, mcpPort)
    if (existing === next) return
    await deps.mkdir(codexDir)
    await deps.writeFile(codexPath, next)
}

async function syncGeminiSettingsJson(
    spawnDirectory: string,
    mcpPort: number,
    deps: WorktreeMcpConfigSyncDeps,
): Promise<void> {
    const geminiDir: string = path.join(spawnDirectory, '.gemini')
    const geminiPath: string = path.join(geminiDir, 'settings.json')
    const existing: string | null = await deps.readFile(geminiPath)
    let parsed: any = {}
    if (existing !== null) {
        try {
            parsed = JSON.parse(existing)
        } catch {
            parsed = {}
        }
    }
    parsed.mcpServers = {
        ...(parsed.mcpServers ?? {}),
        [VOICETREE_MCP_SERVER_NAME]: {
            url: `http://127.0.0.1:${mcpPort}/mcp`,
            trust: true,
        },
    }
    const next: string = JSON.stringify(parsed, null, 2)
    if (existing === next) return
    await deps.mkdir(geminiDir)
    await deps.writeFile(geminiPath, next)
}

export async function syncWorktreeMcpClientConfigs(
    spawnDirectory: string,
    agentCommand: string,
    mcpPort: number,
    deps: WorktreeMcpConfigSyncDeps = defaultDeps,
): Promise<void> {
    await syncMcpJson(spawnDirectory, mcpPort, deps)
    if (isCodexAgent(agentCommand)) {
        await syncCodexToml(spawnDirectory, mcpPort, deps)
    }
    if (isGeminiAgent(agentCommand)) {
        await syncGeminiSettingsJson(spawnDirectory, mcpPort, deps)
    }
}

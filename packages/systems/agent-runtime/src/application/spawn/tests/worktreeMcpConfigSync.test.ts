/**
 * Black-box tests for the worktree MCP-config sync edge helper.
 *
 * Inputs: a spawn directory path, an agent command string, a live MCP port,
 *   plus an in-memory filesystem dep.
 * Outputs (asserted): the contents of the `.mcp.json` / `.codex/config.toml`
 *   files captured by the in-memory fs.
 *
 * Background: when an agent spawns in a worktree (e.g. `vt-wts/<branch>`),
 * the worktree's `.mcp.json` and `.codex/config.toml` were checked in or
 * inherited with a stale port. Claude Code / Codex CLIs read those files
 * from cwd, so unless we refresh them at spawn time, the agent attaches to
 * the wrong MCP server (or none at all). See memory note "Worktree MCP port
 * trap" for the original incident.
 */

import {describe, it, expect} from 'vitest'
import path from 'node:path'
import {
    syncWorktreeMcpClientConfigs,
    type WorktreeMcpConfigSyncDeps,
} from '../worktreeMcpConfigSync'

const SPAWN_DIR: string = '/repo/.worktrees/wt-feature'
const MCP_JSON_PATH: string = path.join(SPAWN_DIR, '.mcp.json')
const CODEX_TOML_PATH: string = path.join(SPAWN_DIR, '.codex', 'config.toml')
const GEMINI_JSON_PATH: string = path.join(SPAWN_DIR, '.gemini', 'settings.json')
const LIVE_PORT: number = 3001
const STALE_PORT: number = 9999

function makeInMemoryFs(initial: Record<string, string> = {}): {
    deps: WorktreeMcpConfigSyncDeps
    files: Map<string, string>
    mkdirCalls: string[]
} {
    const files: Map<string, string> = new Map(Object.entries(initial))
    const mkdirCalls: string[] = []
    return {
        files,
        mkdirCalls,
        deps: {
            mkdir: async (dir: string): Promise<void> => {
                mkdirCalls.push(dir)
            },
            readFile: async (filePath: string): Promise<string | null> =>
                files.get(filePath) ?? null,
            writeFile: async (filePath: string, content: string): Promise<void> => {
                files.set(filePath, content)
            },
        },
    }
}

describe('syncWorktreeMcpClientConfigs — .mcp.json (any agent)', () => {
    it('rewrites a stale .mcp.json voicetree port to the live port', async () => {
        const fs = makeInMemoryFs({
            [MCP_JSON_PATH]: JSON.stringify(
                {
                    mcpServers: {
                        voicetree: {type: 'http', url: `http://127.0.0.1:${STALE_PORT}/mcp`},
                    },
                },
                null,
                2,
            ),
        })

        await syncWorktreeMcpClientConfigs(SPAWN_DIR, 'claude --prompt x', LIVE_PORT, fs.deps)

        const updated = JSON.parse(fs.files.get(MCP_JSON_PATH) ?? '{}')
        expect(updated.mcpServers.voicetree.url).toBe(`http://127.0.0.1:${LIVE_PORT}/mcp`)
        expect(updated.mcpServers.voicetree.type).toBe('http')
    })

    it('creates .mcp.json when the worktree has none (fresh checkout)', async () => {
        const fs = makeInMemoryFs()

        await syncWorktreeMcpClientConfigs(SPAWN_DIR, 'claude', LIVE_PORT, fs.deps)

        const created = JSON.parse(fs.files.get(MCP_JSON_PATH) ?? '{}')
        expect(created.mcpServers.voicetree.url).toBe(`http://127.0.0.1:${LIVE_PORT}/mcp`)
    })

    it('preserves other MCP servers when updating voicetree port', async () => {
        const fs = makeInMemoryFs({
            [MCP_JSON_PATH]: JSON.stringify(
                {
                    mcpServers: {
                        voicetree: {type: 'http', url: `http://127.0.0.1:${STALE_PORT}/mcp`},
                        other: {type: 'http', url: 'http://localhost:7000/mcp'},
                    },
                },
                null,
                2,
            ),
        })

        await syncWorktreeMcpClientConfigs(SPAWN_DIR, 'claude', LIVE_PORT, fs.deps)

        const updated = JSON.parse(fs.files.get(MCP_JSON_PATH) ?? '{}')
        expect(updated.mcpServers.voicetree.url).toBe(`http://127.0.0.1:${LIVE_PORT}/mcp`)
        expect(updated.mcpServers.other.url).toBe('http://localhost:7000/mcp')
    })

    it('is idempotent when port already matches', async () => {
        const correctContent: string = JSON.stringify(
            {
                mcpServers: {
                    voicetree: {type: 'http', url: `http://127.0.0.1:${LIVE_PORT}/mcp`},
                },
            },
            null,
            2,
        )
        const fs = makeInMemoryFs({[MCP_JSON_PATH]: correctContent})

        await syncWorktreeMcpClientConfigs(SPAWN_DIR, 'claude', LIVE_PORT, fs.deps)

        expect(fs.mkdirCalls).toEqual([])
        expect(fs.files.get(MCP_JSON_PATH)).toBe(correctContent)
    })
})

describe('syncWorktreeMcpClientConfigs — .codex/config.toml (codex only)', () => {
    it('rewrites stale codex toml port to the live port when agent is codex', async () => {
        const fs = makeInMemoryFs({
            [CODEX_TOML_PATH]: `[mcp_servers.voicetree]\nurl = "http://localhost:${STALE_PORT}/mcp"\n`,
        })

        await syncWorktreeMcpClientConfigs(SPAWN_DIR, 'codex --prompt x', LIVE_PORT, fs.deps)

        expect(fs.files.get(CODEX_TOML_PATH)).toBe(
            `[mcp_servers.voicetree]\nurl = "http://localhost:${LIVE_PORT}/mcp"\n`,
        )
    })

    it('creates codex toml when missing in a fresh worktree (codex agent)', async () => {
        const fs = makeInMemoryFs()

        await syncWorktreeMcpClientConfigs(SPAWN_DIR, 'codex', LIVE_PORT, fs.deps)

        expect(fs.files.get(CODEX_TOML_PATH)).toBe(
            `[mcp_servers.voicetree]\nurl = "http://localhost:${LIVE_PORT}/mcp"\n`,
        )
    })

    it('preserves unrelated toml sections when rewriting voicetree port', async () => {
        const fs = makeInMemoryFs({
            [CODEX_TOML_PATH]:
                '[other_section]\nfoo = "bar"\n\n' +
                `[mcp_servers.voicetree]\nurl = "http://localhost:${STALE_PORT}/mcp"\n`,
        })

        await syncWorktreeMcpClientConfigs(SPAWN_DIR, 'codex', LIVE_PORT, fs.deps)

        const updated: string = fs.files.get(CODEX_TOML_PATH) ?? ''
        expect(updated).toContain('[other_section]')
        expect(updated).toContain('foo = "bar"')
        expect(updated).toContain(`url = "http://localhost:${LIVE_PORT}/mcp"`)
        expect(updated).not.toContain(String(STALE_PORT))
    })

    it('does NOT create codex toml for non-codex agents', async () => {
        const fs = makeInMemoryFs()

        await syncWorktreeMcpClientConfigs(SPAWN_DIR, 'claude', LIVE_PORT, fs.deps)

        expect(fs.files.get(CODEX_TOML_PATH)).toBeUndefined()
    })

    it('does NOT touch an existing codex toml for non-codex agents', async () => {
        const initial: string = `[mcp_servers.voicetree]\nurl = "http://localhost:${STALE_PORT}/mcp"\n`
        const fs = makeInMemoryFs({[CODEX_TOML_PATH]: initial})

        await syncWorktreeMcpClientConfigs(SPAWN_DIR, 'claude', LIVE_PORT, fs.deps)

        expect(fs.files.get(CODEX_TOML_PATH)).toBe(initial)
    })

    it('matches "codex" case-insensitively (e.g. "CODEX" in the command)', async () => {
        const fs = makeInMemoryFs()

        await syncWorktreeMcpClientConfigs(SPAWN_DIR, 'CODEX --prompt x', LIVE_PORT, fs.deps)

        expect(fs.files.get(CODEX_TOML_PATH)).toContain(`http://localhost:${LIVE_PORT}/mcp`)
    })
})

describe('syncWorktreeMcpClientConfigs — .gemini/settings.json (Gemini only)', () => {
    it('rewrites stale gemini json port to the live port when agent is gemini', async () => {
        const fs = makeInMemoryFs({
            [GEMINI_JSON_PATH]: JSON.stringify({
                mcpServers: {
                    voicetree: { url: `http://127.0.0.1:${STALE_PORT}/mcp` }
                }
            }, null, 2)
        })

        await syncWorktreeMcpClientConfigs(SPAWN_DIR, 'gemini --prompt x', LIVE_PORT, fs.deps)

        const updated = JSON.parse(fs.files.get(GEMINI_JSON_PATH) ?? '{}')
        expect(updated.mcpServers.voicetree.url).toBe(`http://127.0.0.1:${LIVE_PORT}/mcp`)
    })

    it('creates gemini json when missing in a fresh worktree (gemini agent)', async () => {
        const fs = makeInMemoryFs()

        await syncWorktreeMcpClientConfigs(SPAWN_DIR, 'gemini', LIVE_PORT, fs.deps)

        const created = JSON.parse(fs.files.get(GEMINI_JSON_PATH) ?? '{}')
        expect(created.mcpServers.voicetree.url).toBe(`http://127.0.0.1:${LIVE_PORT}/mcp`)
    })

    it('does NOT create gemini json for non-gemini agents', async () => {
        const fs = makeInMemoryFs()

        await syncWorktreeMcpClientConfigs(SPAWN_DIR, 'claude', LIVE_PORT, fs.deps)

        expect(fs.files.get(GEMINI_JSON_PATH)).toBeUndefined()
    })
})

/**
 * Black-box tests for `stripStaleVoicetreeMcpEntries`.
 *
 * The migrator runs once at vault open. It scrubs any legacy `voicetree`
 * entry from external coding-agent config files (.mcp.json, opencode.jsonc,
 * .codex/config.toml) while preserving every other entry the user might
 * have configured (Linear, custom servers, $schema, model selection, etc.).
 *
 * Tests use a real temp directory and assert on file contents — no internal
 * mocks. The migrator is invoked end-to-end through its public entry point.
 */

import {promises as fs} from 'fs'
import os from 'os'
import path from 'path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {stripStaleVoicetreeMcpEntries} from './mcp-client-config'

let testDir: string

beforeEach(async () => {
    testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-strip-stale-'))
})

afterEach(async () => {
    await fs.rm(testDir, {recursive: true, force: true})
})

async function readJson(filePath: string): Promise<unknown> {
    return JSON.parse(await fs.readFile(filePath, 'utf-8'))
}

describe('stripStaleVoicetreeMcpEntries — .mcp.json', () => {
    it('removes a stale voicetree entry while preserving other servers', async () => {
        const mcpJsonPath: string = path.join(testDir, '.mcp.json')
        await fs.writeFile(mcpJsonPath, JSON.stringify({
            mcpServers: {
                voicetree: {type: 'http', url: 'http://127.0.0.1:3001/mcp'},
                linear: {type: 'http', url: 'http://127.0.0.1:9999/mcp'},
            },
        }, null, 2))

        await stripStaleVoicetreeMcpEntries(testDir, {stopAtAncestor: testDir})

        const result = await readJson(mcpJsonPath) as {mcpServers: Record<string, unknown>}
        expect(result.mcpServers.voicetree).toBeUndefined()
        expect(result.mcpServers.linear).toEqual({type: 'http', url: 'http://127.0.0.1:9999/mcp'})
    })

    it('removes the mcpServers object entirely when only voicetree was present', async () => {
        const mcpJsonPath: string = path.join(testDir, '.mcp.json')
        await fs.writeFile(mcpJsonPath, JSON.stringify({
            mcpServers: {voicetree: {type: 'http', url: 'http://127.0.0.1:3001/mcp'}},
        }, null, 2))

        await stripStaleVoicetreeMcpEntries(testDir, {stopAtAncestor: testDir})

        const result = await readJson(mcpJsonPath) as Record<string, unknown>
        expect(result.mcpServers).toBeUndefined()
    })

    it('is idempotent — repeat calls do not corrupt a clean file', async () => {
        const mcpJsonPath: string = path.join(testDir, '.mcp.json')
        const cleanConfig = {mcpServers: {linear: {type: 'http', url: 'http://127.0.0.1:9999/mcp'}}}
        await fs.writeFile(mcpJsonPath, JSON.stringify(cleanConfig, null, 2))

        await stripStaleVoicetreeMcpEntries(testDir, {stopAtAncestor: testDir})
        await stripStaleVoicetreeMcpEntries(testDir, {stopAtAncestor: testDir})

        const result = await readJson(mcpJsonPath)
        expect(result).toEqual(cleanConfig)
    })

    it('default boundary (os.homedir) is implied when no options are passed', async () => {
        const mcpJsonPath: string = path.join(testDir, '.mcp.json')
        await fs.writeFile(mcpJsonPath, JSON.stringify({
            mcpServers: {voicetree: {type: 'http', url: 'http://127.0.0.1:3001/mcp'}, linear: {type: 'http', url: 'l'}},
        }))

        await stripStaleVoicetreeMcpEntries(testDir)

        const result = await readJson(mcpJsonPath) as {mcpServers: Record<string, unknown>}
        expect(result.mcpServers.voicetree).toBeUndefined()
        expect(result.mcpServers.linear).toBeDefined()
    })

    it('is a no-op when the file does not exist', async () => {
        await stripStaleVoicetreeMcpEntries(testDir, {stopAtAncestor: testDir})
        const exists: boolean = await fs.stat(path.join(testDir, '.mcp.json')).then(() => true, () => false)
        expect(exists).toBe(false)
    })
})

describe('stripStaleVoicetreeMcpEntries — opencode.jsonc', () => {
    it('removes voicetree entry while preserving other servers and root keys', async () => {
        const opencodePath: string = path.join(testDir, 'opencode.jsonc')
        await fs.writeFile(opencodePath, JSON.stringify({
            $schema: 'https://opencode.ai/config.json',
            model: 'anthropic/claude-sonnet-4-5',
            mcp: {
                voicetree: {type: 'remote', url: 'http://127.0.0.1:3001/mcp', enabled: true},
                other: {type: 'remote', url: 'http://localhost:8080/mcp'},
            },
        }, null, 2))

        await stripStaleVoicetreeMcpEntries(testDir, {stopAtAncestor: testDir})

        const result = await readJson(opencodePath) as {model?: string; mcp: Record<string, unknown>; $schema: string}
        expect(result.mcp.voicetree).toBeUndefined()
        expect(result.mcp.other).toEqual({type: 'remote', url: 'http://localhost:8080/mcp'})
        expect(result.model).toBe('anthropic/claude-sonnet-4-5')
        expect(result.$schema).toBe('https://opencode.ai/config.json')
    })

    it('removes the mcp object entirely when only voicetree was present, leaving root keys intact', async () => {
        const opencodePath: string = path.join(testDir, 'opencode.jsonc')
        await fs.writeFile(opencodePath, JSON.stringify({
            $schema: 'https://opencode.ai/config.json',
            mcp: {voicetree: {type: 'remote', url: 'http://127.0.0.1:3001/mcp', enabled: true}},
        }, null, 2))

        await stripStaleVoicetreeMcpEntries(testDir, {stopAtAncestor: testDir})

        const result = await readJson(opencodePath) as {$schema: string; mcp?: unknown}
        expect(result.mcp).toBeUndefined()
        expect(result.$schema).toBe('https://opencode.ai/config.json')
    })
})

describe('stripStaleVoicetreeMcpEntries — .codex/config.toml', () => {
    it('removes the [mcp_servers.voicetree] block while preserving other blocks', async () => {
        const codexDir: string = path.join(testDir, '.codex')
        await fs.mkdir(codexDir)
        const codexPath: string = path.join(codexDir, 'config.toml')
        const initial: string =
            '[mcp_servers.voicetree]\n' +
            'url = "http://localhost:3001/mcp"\n' +
            '\n' +
            '[mcp_servers.other]\n' +
            'url = "http://localhost:8080/mcp"\n'
        await fs.writeFile(codexPath, initial)

        await stripStaleVoicetreeMcpEntries(testDir, {stopAtAncestor: testDir})

        const result: string = await fs.readFile(codexPath, 'utf-8')
        expect(result).not.toContain('[mcp_servers.voicetree]')
        expect(result).toContain('[mcp_servers.other]')
        expect(result).toContain('url = "http://localhost:8080/mcp"')
    })

    it('deletes the config.toml when only the voicetree block was present', async () => {
        const codexDir: string = path.join(testDir, '.codex')
        await fs.mkdir(codexDir)
        const codexPath: string = path.join(codexDir, 'config.toml')
        await fs.writeFile(codexPath, '[mcp_servers.voicetree]\nurl = "http://localhost:3001/mcp"\n')

        await stripStaleVoicetreeMcpEntries(testDir, {stopAtAncestor: testDir})

        const exists: boolean = await fs.stat(codexPath).then(() => true, () => false)
        expect(exists).toBe(false)
    })

    it('is a no-op when the file does not contain the voicetree section', async () => {
        const codexDir: string = path.join(testDir, '.codex')
        await fs.mkdir(codexDir)
        const codexPath: string = path.join(codexDir, 'config.toml')
        const initial: string = '[mcp_servers.other]\nurl = "http://localhost:8080/mcp"\n'
        await fs.writeFile(codexPath, initial)

        await stripStaleVoicetreeMcpEntries(testDir, {stopAtAncestor: testDir})

        const result: string = await fs.readFile(codexPath, 'utf-8')
        expect(result).toBe(initial)
    })
})

describe('stripStaleVoicetreeMcpEntries — combined cleanup', () => {
    it('cleans all three file types in a single pass', async () => {
        const mcpJsonPath: string = path.join(testDir, '.mcp.json')
        const opencodePath: string = path.join(testDir, 'opencode.jsonc')
        const codexDir: string = path.join(testDir, '.codex')
        await fs.mkdir(codexDir)
        const codexPath: string = path.join(codexDir, 'config.toml')

        await fs.writeFile(mcpJsonPath, JSON.stringify({
            mcpServers: {voicetree: {type: 'http', url: 'x'}, linear: {type: 'http', url: 'y'}},
        }))
        await fs.writeFile(opencodePath, JSON.stringify({
            $schema: 's', mcp: {voicetree: {type: 'remote', url: 'x'}, custom: {type: 'remote', url: 'y'}},
        }))
        await fs.writeFile(codexPath, '[mcp_servers.voicetree]\nurl = "x"\n\n[mcp_servers.custom]\nurl = "y"\n')

        await stripStaleVoicetreeMcpEntries(testDir, {stopAtAncestor: testDir})

        const mcpJson = await readJson(mcpJsonPath) as {mcpServers: Record<string, unknown>}
        expect(mcpJson.mcpServers.voicetree).toBeUndefined()
        expect(mcpJson.mcpServers.linear).toBeDefined()

        const opencode = await readJson(opencodePath) as {mcp: Record<string, unknown>}
        expect(opencode.mcp.voicetree).toBeUndefined()
        expect(opencode.mcp.custom).toBeDefined()

        const codex: string = await fs.readFile(codexPath, 'utf-8')
        expect(codex).not.toContain('[mcp_servers.voicetree]')
        expect(codex).toContain('[mcp_servers.custom]')
    })
})

describe('stripStaleVoicetreeMcpEntries — parent walk to stopAtAncestor', () => {
    it('strips voicetree from every ancestor .mcp.json up to and including the boundary', async () => {
        const childDir: string = path.join(testDir, 'child')
        const grandchildDir: string = path.join(childDir, 'grandchild')
        await fs.mkdir(grandchildDir, {recursive: true})

        await fs.writeFile(path.join(testDir, '.mcp.json'), JSON.stringify({
            mcpServers: {
                voicetree: {type: 'http', url: 'http://127.0.0.1:3001/mcp'},
                linear: {type: 'http', url: 'http://127.0.0.1:9999/mcp'},
            },
        }))
        await fs.writeFile(path.join(childDir, '.mcp.json'), JSON.stringify({
            mcpServers: {
                voicetree: {type: 'http', url: 'http://127.0.0.1:3001/mcp'},
                custom: {type: 'http', url: 'http://localhost:8080/mcp'},
            },
        }))
        await fs.writeFile(path.join(grandchildDir, '.mcp.json'), JSON.stringify({
            mcpServers: {voicetree: {type: 'http', url: 'http://127.0.0.1:3001/mcp'}},
        }))

        await stripStaleVoicetreeMcpEntries(grandchildDir, {stopAtAncestor: testDir})

        const grandchild = await readJson(path.join(grandchildDir, '.mcp.json')) as Record<string, unknown>
        expect(grandchild.mcpServers).toBeUndefined()

        const child = await readJson(path.join(childDir, '.mcp.json')) as {mcpServers: Record<string, unknown>}
        expect(child.mcpServers.voicetree).toBeUndefined()
        expect(child.mcpServers.custom).toEqual({type: 'http', url: 'http://localhost:8080/mcp'})

        const root = await readJson(path.join(testDir, '.mcp.json')) as {mcpServers: Record<string, unknown>}
        expect(root.mcpServers.voicetree).toBeUndefined()
        expect(root.mcpServers.linear).toEqual({type: 'http', url: 'http://127.0.0.1:9999/mcp'})
    })

    it('does not cross the boundary — files above stopAtAncestor are untouched', async () => {
        const childDir: string = path.join(testDir, 'child')
        await fs.mkdir(childDir, {recursive: true})

        const outsideDir: string = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-strip-outside-'))
        try {
            const outsideMcp: string = path.join(outsideDir, '.mcp.json')
            const outsideContent = {mcpServers: {voicetree: {type: 'http', url: 'http://127.0.0.1:3001/mcp'}}}
            await fs.writeFile(outsideMcp, JSON.stringify(outsideContent))

            await stripStaleVoicetreeMcpEntries(childDir, {stopAtAncestor: testDir})

            const outside = await readJson(outsideMcp)
            expect(outside).toEqual(outsideContent)
        } finally {
            await fs.rm(outsideDir, {recursive: true, force: true})
        }
    })

    it('falls back to single-directory scan when directory is outside stopAtAncestor', async () => {
        const otherBoundary: string = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-strip-other-'))
        try {
            await fs.writeFile(path.join(testDir, '.mcp.json'), JSON.stringify({
                mcpServers: {
                    voicetree: {type: 'http', url: 'http://127.0.0.1:3001/mcp'},
                    linear: {type: 'http', url: 'http://127.0.0.1:9999/mcp'},
                },
            }))

            await stripStaleVoicetreeMcpEntries(testDir, {stopAtAncestor: otherBoundary})

            const result = await readJson(path.join(testDir, '.mcp.json')) as {mcpServers: Record<string, unknown>}
            expect(result.mcpServers.voicetree).toBeUndefined()
            expect(result.mcpServers.linear).toBeDefined()
        } finally {
            await fs.rm(otherBoundary, {recursive: true, force: true})
        }
    })

    it('walks parents for all three file types together', async () => {
        const childDir: string = path.join(testDir, 'child')
        await fs.mkdir(path.join(testDir, '.codex'))
        await fs.mkdir(path.join(childDir, '.codex'), {recursive: true})

        await fs.writeFile(path.join(testDir, '.mcp.json'), JSON.stringify({
            mcpServers: {voicetree: {type: 'http', url: 'x'}},
        }))
        await fs.writeFile(path.join(testDir, 'opencode.jsonc'), JSON.stringify({
            mcp: {voicetree: {type: 'remote', url: 'x'}},
        }))
        await fs.writeFile(path.join(testDir, '.codex', 'config.toml'),
            '[mcp_servers.voicetree]\nurl = "x"\n')

        await fs.writeFile(path.join(childDir, '.mcp.json'), JSON.stringify({
            mcpServers: {voicetree: {type: 'http', url: 'y'}},
        }))
        await fs.writeFile(path.join(childDir, 'opencode.jsonc'), JSON.stringify({
            mcp: {voicetree: {type: 'remote', url: 'y'}},
        }))
        await fs.writeFile(path.join(childDir, '.codex', 'config.toml'),
            '[mcp_servers.voicetree]\nurl = "y"\n')

        await stripStaleVoicetreeMcpEntries(childDir, {stopAtAncestor: testDir})

        for (const dir of [testDir, childDir]) {
            const mcp = await readJson(path.join(dir, '.mcp.json')) as Record<string, unknown>
            expect(mcp.mcpServers).toBeUndefined()

            const opencode = await readJson(path.join(dir, 'opencode.jsonc')) as Record<string, unknown>
            expect(opencode.mcp).toBeUndefined()

            const codexExists: boolean = await fs.stat(path.join(dir, '.codex', 'config.toml'))
                .then(() => true, () => false)
            expect(codexExists).toBe(false)
        }
    })
})

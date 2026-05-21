import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { syncWorktreeMcpClientConfigs } from '../worktreeMcpConfigSync'

describe('syncWorktreeMcpClientConfigs (Blackbox - Real FS)', () => {
    let tempDir: string

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'vt-mcp-sync-test-'))
    })

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true })
    })

    it('syncs .mcp.json and .gemini/settings.json to a real directory', async () => {
        const LIVE_PORT = 3001
        
        // 1. Initial sync (creates files)
        await syncWorktreeMcpClientConfigs(tempDir, 'gemini', LIVE_PORT)

        const mcpJson = JSON.parse(await fs.readFile(path.join(tempDir, '.mcp.json'), 'utf-8'))
        expect(mcpJson.mcpServers.voicetree.url).toBe(`http://127.0.0.1:${LIVE_PORT}/mcp`)

        const geminiJson = JSON.parse(await fs.readFile(path.join(tempDir, '.gemini', 'settings.json'), 'utf-8'))
        expect(geminiJson.mcpServers.voicetree.url).toBe(`http://127.0.0.1:${LIVE_PORT}/mcp`)
        expect(geminiJson.mcpServers.voicetree.trust).toBe(true)

        // 2. Update sync (changes port)
        const NEW_PORT = 3002
        await syncWorktreeMcpClientConfigs(tempDir, 'gemini', NEW_PORT)

        const mcpJsonUpdated = JSON.parse(await fs.readFile(path.join(tempDir, '.mcp.json'), 'utf-8'))
        expect(mcpJsonUpdated.mcpServers.voicetree.url).toBe(`http://127.0.0.1:${NEW_PORT}/mcp`)

        const geminiJsonUpdated = JSON.parse(await fs.readFile(path.join(tempDir, '.gemini', 'settings.json'), 'utf-8'))
        expect(geminiJsonUpdated.mcpServers.voicetree.url).toBe(`http://127.0.0.1:${NEW_PORT}/mcp`)
    })
})

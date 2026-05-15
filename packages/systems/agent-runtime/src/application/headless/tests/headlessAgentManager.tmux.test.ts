import {randomUUID} from 'node:crypto'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterAll, afterEach, describe, expect, it} from 'vitest'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import {
    closeHeadlessAgent,
    getHeadlessAgentOutput,
    sendHeadlessAgentInput,
    spawnHeadlessAgent,
} from '../headlessAgentManager'
import {createTerminalData, type TerminalData, type TerminalId} from '../../terminals/terminal-registry/types'
import {clearTerminalRecords} from '../../terminals/terminal-registry'
import {hasSession, killSession} from '../../terminals/tmux-session-manager'

type TmuxMetadata = {
    readonly status: 'running' | 'exited'
    readonly pid: number
    readonly exitCode?: number | null
}

const sessions: Set<string> = new Set<string>()
const tempDirs: Set<string> = new Set<string>()

function makeName(): TerminalId {
    return `bf311-${randomUUID().slice(0, 8)}` as TerminalId
}

async function makeTempVault(): Promise<string> {
    const dir: string = await mkdtemp(join(tmpdir(), 'bf311-vault-'))
    tempDirs.add(dir)
    return dir
}

async function waitFor(assertion: () => Promise<boolean>, timeoutMs: number = 7000): Promise<void> {
    const started: number = Date.now()
    while (Date.now() - started < timeoutMs) {
        if (await assertion()) return
        await new Promise((resolve) => setTimeout(resolve, 50))
    }
    throw new Error('timed out waiting for condition')
}

async function readText(path: string): Promise<string> {
    try {
        return await readFile(path, 'utf8')
    } catch {
        return ''
    }
}

async function readMetadata(path: string): Promise<TmuxMetadata | null> {
    const raw: string = await readText(path)
    return raw ? JSON.parse(raw) as TmuxMetadata : null
}

function makeTerminalData(terminalId: TerminalId, vaultPath: string): TerminalData {
    return createTerminalData({
        terminalId,
        attachedToNodeId: join(vaultPath, 'context.md') as NodeIdAndFilePath,
        terminalCount: 0,
        title: 'BF311 tmux headless',
        agentName: terminalId,
        isHeadless: true,
        initialEnvVars: {
            VOICETREE_TERMINAL_ID: terminalId,
            VOICETREE_VAULT_PATH: vaultPath,
        },
    })
}

async function cleanup(): Promise<void> {
    await Promise.all([...sessions].map(async (name: string) => {
        await killSession(name)
        sessions.delete(name)
    }))
    await Promise.all([...tempDirs].map(async (dir: string) => {
        await rm(dir, {recursive: true, force: true})
        tempDirs.delete(dir)
    }))
    clearTerminalRecords()
}

describe('headlessAgentManager tmux backend', () => {
    afterEach(cleanup)
    afterAll(cleanup)

    it('spawns a real tmux-backed headless agent, captures log output, accepts input, and marks natural exit', async () => {
        const terminalId: TerminalId = makeName()
        const vaultPath: string = await makeTempVault()
        const terminalDir: string = join(vaultPath, '.voicetree', 'terminals')
        const metadataPath: string = join(terminalDir, `${terminalId}.json`)
        const logPath: string = join(terminalDir, `${terminalId}.log`)
        sessions.add(terminalId)

        spawnHeadlessAgent(
            terminalId,
            makeTerminalData(terminalId, vaultPath),
            `bash -lc 'echo BF311_READY; while IFS= read -r line; do echo BF311_GOT:$line; [ "$line" = "BF311_EXIT" ] && break; done'`,
            vaultPath,
            {VOICETREE_TERMINAL_ID: terminalId, VOICETREE_VAULT_PATH: vaultPath},
            undefined,
            'tmux',
        )

        await waitFor(async () => (await readMetadata(metadataPath))?.status === 'running')
        const running: TmuxMetadata | null = await readMetadata(metadataPath)
        expect(running?.pid).toBeGreaterThan(0)
        await waitFor(async () => (await readText(logPath)).includes('BF311_READY'))

        await expect(sendHeadlessAgentInput(terminalId, 'BF311_INPUT')).resolves.toEqual({success: true})
        await waitFor(async () => (await readText(logPath)).includes('BF311_GOT:BF311_INPUT'))
        expect(getHeadlessAgentOutput(terminalId)).toContain('BF311_GOT:BF311_INPUT')

        await expect(sendHeadlessAgentInput(terminalId, 'BF311_EXIT')).resolves.toEqual({success: true})
        await waitFor(async () => (await readMetadata(metadataPath))?.status === 'exited')
        const exited: TmuxMetadata | null = await readMetadata(metadataPath)
        expect(exited?.exitCode).toBeNull()
        await waitFor(async () => !(await hasSession(terminalId)))
        sessions.delete(terminalId)
        closeHeadlessAgent(terminalId)
    }, 15000)
})

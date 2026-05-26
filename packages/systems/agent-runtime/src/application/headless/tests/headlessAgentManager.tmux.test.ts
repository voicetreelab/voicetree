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
    spawnTmuxBackedTerminal,
} from '../headlessAgentManager'
import {createTerminalData, type TerminalData, type TerminalId} from '../../terminals/terminal-registry/types'
import {clearTerminalRecords, getTerminalRecords} from '../../terminals/terminal-registry'
import {hasSession, killSession} from '../../terminals/tmux/tmux-session-manager'
import {TerminalManager} from '../../terminals/terminal-manager'

type TmuxMetadata = {
    readonly status: 'running' | 'exited'
    readonly pid: number
    readonly exitCode?: number | null
    readonly terminalData: TerminalData
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

function makeTerminalData(terminalId: TerminalId, projectRoot: string): TerminalData {
    return createTerminalData({
        terminalId,
        attachedToNodeId: join(projectRoot, 'context.md') as NodeIdAndFilePath,
        terminalCount: 0,
        title: 'BF311 tmux headless',
        agentName: terminalId,
        isHeadless: true,
        initialEnvVars: {
            VOICETREE_TERMINAL_ID: terminalId,
            VOICETREE_VAULT_PATH: projectRoot,
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
        const projectRoot: string = await makeTempVault()
        const terminalDir: string = join(projectRoot, '.voicetree', 'terminals')
        const metadataPath: string = join(terminalDir, `${terminalId}.json`)
        const logPath: string = join(terminalDir, `${terminalId}.log`)
        sessions.add(terminalId)

        spawnHeadlessAgent(
            terminalId,
            makeTerminalData(terminalId, projectRoot),
            `bash -lc 'echo BF311_READY; while IFS= read -r line; do echo BF311_GOT:$line; [ "$line" = "BF311_EXIT" ] && break; done'`,
            projectRoot,
            {VOICETREE_TERMINAL_ID: terminalId, VOICETREE_VAULT_PATH: projectRoot},
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
        expect(exited?.exitCode).toBe(0)
        await waitFor(async () => !(await hasSession(terminalId)))
        sessions.delete(terminalId)
        await closeHeadlessAgent(terminalId)
    }, 15000)

    // M1-fix: Phase 4 (Electron interactive) creates tmux sessions via the same
    // helper as Phase 2 (headless). The relay's WS attach can only connect to
    // sessions that already exist; this verifies the missing-session class of
    // failure Wei observed cannot recur.
    it('spawns a tmux-backed interactive terminal (isHeadless=false) and persists the original terminalData for reconciliation', async () => {
        const terminalId: TerminalId = makeName()
        const projectRoot: string = await makeTempVault()
        const metadataPath: string = join(projectRoot, '.voicetree', 'terminals', `${terminalId}.json`)
        sessions.add(terminalId)

        const interactiveTerminalData: TerminalData = createTerminalData({
            terminalId,
            attachedToNodeId: join(projectRoot, 'context.md') as NodeIdAndFilePath,
            terminalCount: 0,
            title: 'M1-fix interactive tmux',
            agentName: terminalId,
            isHeadless: false,
            initialEnvVars: {
                VOICETREE_TERMINAL_ID: terminalId,
                VOICETREE_VAULT_PATH: projectRoot,
            },
        })

        const created: {readonly pid: number} = await spawnTmuxBackedTerminal(
            terminalId,
            interactiveTerminalData,
            '/bin/bash -l',
            projectRoot,
            {VOICETREE_TERMINAL_ID: terminalId, VOICETREE_VAULT_PATH: projectRoot},
        )
        expect(created.pid).toBeGreaterThan(0)

        await waitFor(async () => hasSession(terminalId))
        const meta: TmuxMetadata | null = await readMetadata(metadataPath)
        expect(meta?.status).toBe('running')
        expect(meta?.terminalData.isHeadless).toBe(false)
        expect(meta?.terminalData.agentName).toBe(terminalId)

        const record = getTerminalRecords().find((r) => r.terminalId === terminalId)
        expect(record).toBeDefined()
        expect(record?.terminalData.isHeadless).toBe(false)

        await killSession(terminalId)
        sessions.delete(terminalId)
        await closeHeadlessAgent(terminalId)
    }, 15000)

    it('preserves tmux sessions when terminal runtime cleanup detaches host state', async () => {
        const terminalId: TerminalId = makeName()
        const projectRoot: string = await makeTempVault()
        const metadataPath: string = join(projectRoot, '.voicetree', 'terminals', `${terminalId}.json`)
        const terminalManager: TerminalManager = new TerminalManager()
        sessions.add(terminalId)

        await spawnTmuxBackedTerminal(
            terminalId,
            makeTerminalData(terminalId, projectRoot),
            `bash -lc 'echo BF311_PRESERVE_READY; sleep 300'`,
            projectRoot,
            {VOICETREE_TERMINAL_ID: terminalId, VOICETREE_VAULT_PATH: projectRoot},
        )
        await waitFor(async () => hasSession(terminalId))
        expect((await readMetadata(metadataPath))?.status).toBe('running')

        terminalManager.cleanup({tmuxSessions: 'preserve'})

        expect(getTerminalRecords()).toEqual([])
        expect(await hasSession(terminalId)).toBe(true)
        expect((await readMetadata(metadataPath))?.status).toBe('running')

        await killSession(terminalId)
        sessions.delete(terminalId)
    }, 15000)

    it('terminates tmux sessions when terminal runtime cleanup is destructive', async () => {
        const terminalId: TerminalId = makeName()
        const projectRoot: string = await makeTempVault()
        const terminalManager: TerminalManager = new TerminalManager()
        sessions.add(terminalId)

        await spawnTmuxBackedTerminal(
            terminalId,
            makeTerminalData(terminalId, projectRoot),
            `bash -lc 'echo BF311_TERMINATE_READY; sleep 300'`,
            projectRoot,
            {VOICETREE_TERMINAL_ID: terminalId, VOICETREE_VAULT_PATH: projectRoot},
        )
        await waitFor(async () => hasSession(terminalId))

        terminalManager.cleanup({tmuxSessions: 'terminate'})

        await waitFor(async () => !(await hasSession(terminalId)))
        sessions.delete(terminalId)
        expect(getTerminalRecords()).toEqual([])
    }, 15000)

    // M1-fix5: tmux sessions outlive Electron. When Electron is killed and
    // relaunched, the renderer triggers a fresh spawnTmuxBacked for the same
    // terminalId. Before M1-fix5, the second call ran `tmux new-session`
    // which failed with "duplicate session" and the panel never reconnected.
    // After the fix, the second call rebinds to the existing pane.
    it('rebinds to an existing tmux session instead of failing with duplicate session (Electron relaunch case)', async () => {
        const terminalId: TerminalId = makeName()
        const projectRoot: string = await makeTempVault()
        const metadataPath: string = join(projectRoot, '.voicetree', 'terminals', `${terminalId}.json`)
        sessions.add(terminalId)

        const td: TerminalData = makeTerminalData(terminalId, projectRoot)
        const first: {readonly pid: number} = await spawnTmuxBackedTerminal(
            terminalId,
            td,
            '/bin/bash -l',
            projectRoot,
            {VOICETREE_TERMINAL_ID: terminalId, VOICETREE_VAULT_PATH: projectRoot},
        )
        expect(first.pid).toBeGreaterThan(0)
        expect(await hasSession(terminalId)).toBe(true)
        const firstMeta: TmuxMetadata | null = await readMetadata(metadataPath)
        expect(firstMeta?.status).toBe('running')
        const originalStartedAt: string | undefined = (firstMeta as unknown as {startedAt?: string})?.startedAt

        const second: {readonly pid: number} = await spawnTmuxBackedTerminal(
            terminalId,
            td,
            '/bin/bash -l',
            projectRoot,
            {VOICETREE_TERMINAL_ID: terminalId, VOICETREE_VAULT_PATH: projectRoot},
        )
        expect(second.pid).toBe(first.pid)
        expect(await hasSession(terminalId)).toBe(true)
        const reboundMeta: TmuxMetadata | null = await readMetadata(metadataPath)
        expect(reboundMeta?.status).toBe('running')
        expect((reboundMeta as unknown as {startedAt?: string})?.startedAt).toBe(originalStartedAt)
        expect(getTerminalRecords().find((r) => r.terminalId === terminalId)).toBeDefined()

        await killSession(terminalId)
        sessions.delete(terminalId)
        await closeHeadlessAgent(terminalId)
    }, 15000)
})

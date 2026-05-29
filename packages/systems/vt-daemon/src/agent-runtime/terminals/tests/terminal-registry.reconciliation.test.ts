import {randomUUID} from 'node:crypto'
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import type {NodeIdAndFilePath} from '@vt/graph-model/graph'
import {clearTerminalRecords, getTerminalRecords, reconcileTmuxTerminalRegistry} from '../terminal-registry'
import {createTerminalData, type TerminalData, type TerminalId} from '../terminal-registry/types'
import {createSession, killSession} from '../tmux/tmux-session-manager'

const sessions: Set<string> = new Set<string>()
const tempDirs: Set<string> = new Set<string>()

function makeName(prefix: string): TerminalId {
    return `${prefix}-${randomUUID().slice(0, 8)}` as TerminalId
}

async function makeTempVault(): Promise<string> {
    const dir: string = await mkdtemp(join(tmpdir(), 'bf314-vault-'))
    tempDirs.add(dir)
    return dir
}

function makeTerminalData(terminalId: TerminalId, projectRoot: string): TerminalData {
    return createTerminalData({
        terminalId,
        attachedToNodeId: join(projectRoot, 'context.md') as NodeIdAndFilePath,
        terminalCount: 0,
        title: 'BF314 reconciled tmux headless',
        agentName: terminalId,
        isHeadless: true,
        initialEnvVars: {
            VOICETREE_TERMINAL_ID: terminalId,
            VOICETREE_PROJECT_PATH: projectRoot,
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

describe('terminal-registry tmux reconciliation', () => {
    afterEach(cleanup)

    it('imports persisted running sessions that still exist and marks stale sessions exited', async () => {
        const projectRoot: string = await makeTempVault()
        const terminalDir: string = join(projectRoot, '.voicetree', 'terminals')
        await mkdir(terminalDir, {recursive: true})

        const aliveId: TerminalId = makeName('bf314-live')
        const staleId: TerminalId = makeName('bf314-stale')
        sessions.add(aliveId)
        await createSession(aliveId, `bash -lc 'sleep 60'`, {VOICETREE_TERMINAL_ID: aliveId})

        const startedAt: string = '2026-05-15T00:00:00.000Z'
        await writeFile(join(terminalDir, `${aliveId}.json`), JSON.stringify({
            name: aliveId,
            status: 'running',
            pid: 123,
            session: aliveId,
            startedAt,
            logFile: join(terminalDir, `${aliveId}.log`),
            terminalData: makeTerminalData(aliveId, projectRoot),
        }, null, 2), 'utf8')
        await writeFile(join(terminalDir, `${staleId}.json`), JSON.stringify({
            name: staleId,
            status: 'running',
            pid: 456,
            session: staleId,
            startedAt,
            logFile: join(terminalDir, `${staleId}.log`),
            terminalData: makeTerminalData(staleId, projectRoot),
        }, null, 2), 'utf8')

        const result = await reconcileTmuxTerminalRegistry(projectRoot, {
            now: () => Date.parse('2026-05-15T01:00:00.000Z'),
        })

        expect(result.imported).toEqual([aliveId])
        expect(result.markedExited).toEqual([staleId])
        const records = getTerminalRecords()
        expect(records).toHaveLength(1)
        expect(records[0].terminalId).toBe(aliveId)
        expect(records[0].status).toBe('running')
        expect(records[0].terminalData.title).toBe('BF314 reconciled tmux headless')
        expect(records[0].spawnedAt).toBe(Date.parse(startedAt))

        const staleMetadata = JSON.parse(await readFile(join(terminalDir, `${staleId}.json`), 'utf8')) as {
            readonly status: string
            readonly exitCode?: number | null
            readonly endedAt?: string
        }
        expect(staleMetadata.status).toBe('exited')
        expect(staleMetadata.exitCode).toBeNull()
        expect(staleMetadata.endedAt).toBe('2026-05-15T01:00:00.000Z')
    }, 15000)
})

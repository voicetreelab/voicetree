import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {afterEach, describe, expect, it} from 'vitest'
import {persistExitedMetadata} from '../tmuxHeadlessRuntime'
import {writeMetadata, type TmuxTerminalMetadata} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/terminal-metadata.ts'
import type {NativeSessionRequest, NativeSessionResult} from '../../recovery/resolvers/resolveNativeSession'
import {makeTerminalData} from '../../recovery/tests/classifier.test-fixtures'
import type {TerminalId} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'

const TERMINAL_ID = 'A' as TerminalId
const WRITER_PID = 4321

const tempDirs: string[] = []

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, {recursive: true, force: true})))
})

async function seedRunningMetadata(overrides: Partial<TmuxTerminalMetadata> = {}): Promise<string> {
    const dir: string = await mkdtemp(join(tmpdir(), 'persist-exited-'))
    tempDirs.push(dir)
    const path: string = join(dir, `${TERMINAL_ID}.json`)
    writeMetadata(path, {
        name: TERMINAL_ID,
        status: 'running',
        pid: 100,
        terminalData: makeTerminalData({initialCommand: 'claude'}),
        ...overrides,
    }, WRITER_PID)
    return path
}

async function read(path: string): Promise<TmuxTerminalMetadata> {
    return JSON.parse(await readFile(path, 'utf8')) as TmuxTerminalMetadata
}

const found = (sessionId: string) =>
    async (_req: NativeSessionRequest): Promise<NativeSessionResult> => ({kind: 'found', sessionId})

describe('persistExitedMetadata — close/exit captures recovery.native (D3)', () => {
    it('flips the record to exited AND backfills recovery.native from the resolver', async () => {
        const path: string = await seedRunningMetadata()

        await persistExitedMetadata(TERMINAL_ID, path, WRITER_PID, 0, found('sess-on-exit'))

        const after = await read(path)
        expect(after.status).toBe('exited')
        expect(after.exitCode).toBe(0)
        expect(after.endedAt).toEqual(expect.any(String))
        expect(after.recovery?.native).toEqual({
            cli: 'claude',
            mode: 'interactive',
            sessionId: 'sess-on-exit',
            capturedAt: expect.any(String),
            source: 'claude-project-transcript',
        })
    })

    it('marks exited but leaves recovery absent when the resolver misses (best-effort)', async () => {
        const path: string = await seedRunningMetadata()

        await persistExitedMetadata(
            TERMINAL_ID,
            path,
            WRITER_PID,
            1,
            async (): Promise<NativeSessionResult> => ({kind: 'not-found', reason: 'no-jsonl-matches'}),
        )

        const after = await read(path)
        expect(after.status).toBe('exited')
        expect(after.exitCode).toBe(1)
        expect(after.recovery).toBeUndefined()
    })

    it('preserves a pre-existing recovery.native and does not re-resolve', async () => {
        let resolverCalls = 0
        const path: string = await seedRunningMetadata({
            recovery: {native: {cli: 'claude', mode: 'interactive', sessionId: 'captured-earlier', capturedAt: '2026-01-01T00:00:00.000Z', source: 'claude-project-transcript'}},
        })

        await persistExitedMetadata(TERMINAL_ID, path, WRITER_PID, 0, async () => {
            resolverCalls += 1
            return {kind: 'found', sessionId: 'should-not-overwrite'}
        })

        const after = await read(path)
        expect(after.status).toBe('exited')
        expect(after.recovery?.native.sessionId).toBe('captured-earlier')
        expect(resolverCalls).toBe(0)
    })

    it('is idempotent: an already-exited record is left untouched', async () => {
        const path: string = await seedRunningMetadata({status: 'exited', endedAt: '2026-05-01T00:00:00.000Z', exitCode: 0})
        let resolverCalls = 0

        await persistExitedMetadata(TERMINAL_ID, path, WRITER_PID, 7, async () => {
            resolverCalls += 1
            return {kind: 'found', sessionId: 'x'}
        })

        const after = await read(path)
        expect(after.endedAt).toBe('2026-05-01T00:00:00.000Z')
        expect(after.exitCode).toBe(0)
        expect(after.recovery).toBeUndefined()
        expect(resolverCalls).toBe(0)
    })
})

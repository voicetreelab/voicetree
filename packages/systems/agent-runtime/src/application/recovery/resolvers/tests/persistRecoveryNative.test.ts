import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {persistRecoveryNative} from '../persistRecoveryNative'
import type {TmuxTerminalMetadata} from '../../../terminals/terminal-registry/terminal-metadata'

let tmpDir: string

beforeEach(() => {
    tmpDir = mkdtempSync(path.join(os.tmpdir(), 'persist-recovery-'))
})

afterEach(() => {
    rmSync(tmpDir, {recursive: true, force: true})
})

function writeExistingMetadata(filename: string, metadata: TmuxTerminalMetadata): string {
    const filePath: string = path.join(tmpDir, filename)
    writeFileSync(filePath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
    return filePath
}

function readBackMetadata(filePath: string): TmuxTerminalMetadata {
    return JSON.parse(readFileSync(filePath, 'utf8')) as TmuxTerminalMetadata
}

describe('persistRecoveryNative — happy path', () => {
    it('merges recovery.native into an existing metadata file without dropping other fields', () => {
        const filePath: string = writeExistingMetadata('A.json', {
            name: 'A',
            status: 'running',
            pid: 12345,
            session: 'vt-abcdefghij-A',
            startedAt: '2026-05-22T10:00:00.000Z',
            logFile: '/some/log',
        })
        const result = persistRecoveryNative(
            {
                metadataPath: filePath,
                cli: 'claude',
                mode: 'interactive',
                sessionId: 'sess-uuid-123',
                source: 'claude-project-transcript',
                providerStorePath: '/Users/x/.claude/projects/foo.jsonl',
            },
            {
                readMetadata: (p) => readBackMetadata(p),
                writeMetadata: (p, m) => writeFileSync(p, `${JSON.stringify(m, null, 2)}\n`, 'utf8'),
                now: () => new Date('2026-05-22T11:00:00.000Z'),
            },
        )
        expect(result.kind).toBe('persisted')
        const persisted = readBackMetadata(filePath)
        expect(persisted.pid).toBe(12345)
        expect(persisted.session).toBe('vt-abcdefghij-A')
        expect(persisted.startedAt).toBe('2026-05-22T10:00:00.000Z')
        expect(persisted.logFile).toBe('/some/log')
        expect(persisted.recovery?.native).toEqual({
            cli: 'claude',
            mode: 'interactive',
            sessionId: 'sess-uuid-123',
            capturedAt: '2026-05-22T11:00:00.000Z',
            source: 'claude-project-transcript',
            providerStorePath: '/Users/x/.claude/projects/foo.jsonl',
        })
    })

    it('overwrites a stale recovery.native handle when called again', () => {
        const filePath: string = writeExistingMetadata('B.json', {
            name: 'B',
            status: 'running',
            recovery: {
                native: {
                    cli: 'codex',
                    mode: 'interactive',
                    sessionId: 'stale-id',
                    capturedAt: '2026-05-22T09:00:00.000Z',
                    source: 'codex-state-index',
                },
            },
        })
        persistRecoveryNative(
            {
                metadataPath: filePath,
                cli: 'codex',
                mode: 'interactive',
                sessionId: 'fresh-id',
                source: 'codex-state-index',
            },
            {
                readMetadata: (p) => readBackMetadata(p),
                writeMetadata: (p, m) => writeFileSync(p, `${JSON.stringify(m, null, 2)}\n`, 'utf8'),
                now: () => new Date('2026-05-22T12:00:00.000Z'),
            },
        )
        const persisted = readBackMetadata(filePath)
        expect(persisted.recovery?.native?.sessionId).toBe('fresh-id')
        expect(persisted.recovery?.native?.capturedAt).toBe('2026-05-22T12:00:00.000Z')
        expect(persisted.recovery?.native?.providerStorePath).toBeUndefined()
    })

    it('omits providerStorePath when the caller does not supply one', () => {
        const filePath: string = writeExistingMetadata('C.json', {name: 'C', status: 'running'})
        persistRecoveryNative(
            {
                metadataPath: filePath,
                cli: 'codex',
                mode: 'headless',
                sessionId: 'thread-x',
                source: 'codex-state-index',
            },
            {
                readMetadata: (p) => readBackMetadata(p),
                writeMetadata: (p, m) => writeFileSync(p, `${JSON.stringify(m, null, 2)}\n`, 'utf8'),
                now: () => new Date('2026-05-22T13:00:00.000Z'),
            },
        )
        const persisted = readBackMetadata(filePath)
        expect(persisted.recovery?.native).toBeDefined()
        expect(persisted.recovery?.native?.providerStorePath).toBeUndefined()
    })
})

describe('persistRecoveryNative — non-happy path', () => {
    it('returns metadata-missing without throwing when the file is gone', () => {
        const result = persistRecoveryNative(
            {
                metadataPath: path.join(tmpDir, 'does-not-exist.json'),
                cli: 'claude',
                mode: 'interactive',
                sessionId: 'sess-x',
                source: 'claude-project-transcript',
            },
            {
                readMetadata: () => null,
                writeMetadata: () => {
                    throw new Error('should not be called when metadata is missing')
                },
                now: () => new Date(),
            },
        )
        expect(result.kind).toBe('metadata-missing')
    })
})

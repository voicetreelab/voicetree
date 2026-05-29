import {promises as fs} from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {b4} from '../../src/scenarios/b4.ts'
import type {ShimLogEntry} from '../../src/types.ts'

describe('b4 — semantic index + search + focus + unseen', () => {
    let tempDir: string
    let shimLogPath: string
    let prevEnv: string | undefined

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'b4-test-'))
        shimLogPath = path.join(tempDir, '.voicetree', 'shim-log.jsonl')
        prevEnv = process.env.VT_BOOTCAMP_SHIM_LOG_PATH
        process.env.VT_BOOTCAMP_SHIM_LOG_PATH = shimLogPath
    })
    afterEach(async () => {
        if (prevEnv === undefined) delete process.env.VT_BOOTCAMP_SHIM_LOG_PATH
        else process.env.VT_BOOTCAMP_SHIM_LOG_PATH = prevEnv
        await fs.rm(tempDir, {recursive: true, force: true})
    })

    it('exports a valid ScenarioSpec literal', () => {
        expect(b4.id).toBe('B4')
        expect(b4.expectedCommands.map((c) => c.verb)).toEqual([
            'graph index',
            'graph search',
            'graph live focus',
            'graph unseen',
        ])
    })

    it('setup writes 20 notes across 4 + meta clusters', async () => {
        await b4.setup(tempDir)
        for (const name of ['auth-jwt-flow.md', 'auth-oauth-handoff.md', 'auth-session-refresh.md']) {
            const raw = await fs.readFile(path.join(tempDir, name), 'utf8')
            expect(raw).toMatch(/authentication flow/i)
        }
        const session = JSON.parse(
            await fs.readFile(path.join(tempDir, '.voicetree', 'session.json'), 'utf8'),
        )
        expect(session.sessions.default.seen).toContain('auth-jwt-flow.md')
        expect(session.sessions.default.seen).toContain('auth-oauth-handoff.md')
    })

    it('successCriteria passes when index dir + expected shim entries exist', async () => {
        await b4.setup(tempDir)
        await fs.mkdir(path.join(tempDir, '.voicetree', 'index'), {recursive: true})
        await fs.writeFile(
            path.join(tempDir, '.voicetree', 'index', 'vectors.bin'),
            Buffer.from([1, 2, 3, 4]),
        )
        await writeShimLog(shimLogPath, [
            entry({argv: ['graph', 'index', '--project', tempDir]}),
            entry({argv: ['graph', 'search', '--query', 'authentication flow', '--top-k', '3']}),
            entry({argv: ['graph', 'live', 'focus', '--file', 'auth-jwt-flow.md', '--hops', '2']}),
            entry({argv: ['graph', 'unseen', '--related-to', 'auth-jwt-flow.md']}),
        ])
        const result = await b4.successCriteria(tempDir)
        expect(result.passed).toBe(true)
    })

    it('successCriteria fails when the index directory is missing', async () => {
        await b4.setup(tempDir)
        const result = await b4.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        expect(result.detail).toMatch(/\.voicetree\/index\//)
    })

    it('successCriteria fails when no graph search invocation carries the right query', async () => {
        await b4.setup(tempDir)
        await fs.mkdir(path.join(tempDir, '.voicetree', 'index'), {recursive: true})
        await fs.writeFile(path.join(tempDir, '.voicetree', 'index', 'vectors.bin'), Buffer.from([1]))
        await writeShimLog(shimLogPath, [
            entry({argv: ['graph', 'index']}),
            entry({argv: ['graph', 'search', '--query', 'unrelated topic']}),
        ])
        const result = await b4.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        expect(result.detail).toMatch(/authentication flow/)
    })
})

function entry(overrides: Partial<ShimLogEntry>): ShimLogEntry {
    return {
        timestampMs: 0,
        argv: [],
        cwd: '/tmp',
        exitCode: 0,
        stderr: '',
        durationMs: 10,
        ...overrides,
    }
}

async function writeShimLog(filePath: string, entries: readonly ShimLogEntry[]): Promise<void> {
    await fs.mkdir(path.dirname(filePath), {recursive: true})
    await fs.writeFile(filePath, entries.map((e) => JSON.stringify(e)).join('\n') + '\n')
}

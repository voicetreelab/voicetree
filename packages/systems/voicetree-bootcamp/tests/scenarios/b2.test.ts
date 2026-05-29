import {promises as fs} from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'
import {b2} from '../../src/scenarios/b2.ts'
import type {ShimLogEntry} from '../../src/types.ts'

const NODE_ID = 'caching-001'

describe('b2 — agent lifecycle', () => {
    let tempDir: string
    let shimLogPath: string
    let prevEnv: string | undefined

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'b2-test-'))
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
        expect(b2.id).toBe('B2')
        expect(b2.expectedCommands.map((c) => c.verb)).toEqual([
            'agent spawn',
            'agent list',
            'agent output',
            'agent send',
            'agent wait',
            'agent close',
        ])
        expect(b2.budgets.tokens).toBe(5000)
    })

    it('setup writes the single caching node with the expected frontmatter', async () => {
        await b2.setup(tempDir)
        const file = path.join(tempDir, 'notes-on-caching.md')
        const raw = await fs.readFile(file, 'utf8')
        expect(raw).toContain(`id: ${NODE_ID}`)
        expect(raw).toContain('Caching strategy')
        expect(raw).toContain('agent_name: Pat')
    })

    it('successCriteria passes when shim log shows a clean spawn → send(write-behind) → close cycle', async () => {
        await b2.setup(tempDir)
        await writeShimLog(shimLogPath, [
            entry({timestampMs: 1000, argv: ['agent', 'spawn', '--node', NODE_ID]}),
            entry({timestampMs: 2000, argv: ['agent', 'list']}),
            entry({timestampMs: 3000, argv: ['agent', 'output', '--terminal', 't1']}),
            entry({timestampMs: 4000, argv: ['agent', 'send', '--terminal', 't1', '--message', 'please add write-behind']}),
            entry({timestampMs: 5000, argv: ['agent', 'wait', '--terminal', 't1']}),
            entry({timestampMs: 6000, argv: ['agent', 'close', '--terminal', 't1']}),
        ])
        const result = await b2.successCriteria(tempDir)
        expect(result.passed).toBe(true)
    })

    it('successCriteria fails when the spawn does not target the seed node', async () => {
        await b2.setup(tempDir)
        await writeShimLog(shimLogPath, [
            entry({timestampMs: 1000, argv: ['agent', 'spawn', '--node', 'wrong-node']}),
            entry({timestampMs: 4000, argv: ['agent', 'send', '--message', 'write-behind']}),
            entry({timestampMs: 6000, argv: ['agent', 'close']}),
        ])
        const result = await b2.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        expect(result.detail).toMatch(/agent spawn did not target/)
    })

    it('successCriteria fails when no write-behind send fires between spawn and close', async () => {
        await b2.setup(tempDir)
        await writeShimLog(shimLogPath, [
            entry({timestampMs: 1000, argv: ['agent', 'spawn', '--node', NODE_ID]}),
            entry({timestampMs: 4000, argv: ['agent', 'send', '--message', 'unrelated follow-up']}),
            entry({timestampMs: 6000, argv: ['agent', 'close']}),
        ])
        const result = await b2.successCriteria(tempDir)
        expect(result.passed).toBe(false)
        expect(result.detail).toMatch(/write-behind/)
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

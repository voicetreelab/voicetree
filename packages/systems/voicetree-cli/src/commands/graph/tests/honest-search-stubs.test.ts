import {describe, expect, it, vi, type MockInstance} from 'vitest'
import {CliError} from '../../output.ts'
import {graphIndex, graphSearch} from '../actions/index-cmds.ts'
import {parseGraphIndexArgs, parseGraphSearchArgs} from '../core/args.ts'

type CommandResult = {
    threw: boolean
    message: string
    stdout: string
}

// Black-box capture: graphIndex/graphSearch never report success — they call
// error() which throws CliError. We assert on the thrown message and confirm
// nothing was printed to stdout (no fabricated index path or hit list).
async function capture(invoke: () => Promise<void>): Promise<CommandResult> {
    const stdoutChunks: string[] = []
    const logSpy: MockInstance = vi.spyOn(console, 'log').mockImplementation(((...values: unknown[]): void => {
        stdoutChunks.push(values.map((value: unknown): string => String(value)).join(' '))
    }) as typeof console.log)

    let threw = false
    let message = ''
    try {
        await invoke()
    } catch (err) {
        if (err instanceof CliError) {
            threw = true
            message = err.message
        } else {
            logSpy.mockRestore()
            throw err
        }
    } finally {
        logSpy.mockRestore()
    }

    return {threw, message, stdout: stdoutChunks.join('\n')}
}

describe('graph index is an honest unimplemented stub', () => {
    it('fails with "not yet available" and prints no fabricated index path', async () => {
        const result: CommandResult = await capture(() => graphIndex(undefined, ['/some/project']))

        expect(result.threw).toBe(true)
        expect(result.message).toMatch(/not yet available/i)
        expect(result.message).not.toMatch(/success/i)
        // It must not claim an index file exists on disk.
        expect(result.message).not.toMatch(/\.vt-search/)
        expect(result.message).not.toMatch(/kg\.db/)
        // Nothing should be printed to stdout — a fabricated success envelope
        // would surface here.
        expect(result.stdout).toBe('')
    })
})

describe('graph search is an honest unimplemented stub', () => {
    it('fails with "not yet available" rather than reporting zero matches', async () => {
        const result: CommandResult = await capture(() =>
            graphSearch(undefined, ['/some/project', 'find', 'me']),
        )

        expect(result.threw).toBe(true)
        expect(result.message).toMatch(/not yet available/i)
        // The dishonest old behavior printed "No graph hits" (indistinguishable
        // from a real empty result). That must be gone.
        expect(result.stdout).not.toMatch(/no graph hits/i)
        expect(result.stdout).toBe('')
    })
})

describe('end-of-options (--) guard', () => {
    it('parseGraphIndexArgs treats a dashed token after -- as the project root', () => {
        expect(parseGraphIndexArgs(['--', '--weird-dir'])).toBe('--weird-dir')
    })

    it('parseGraphIndexArgs still rejects an unknown flag before --', () => {
        expect(() => parseGraphIndexArgs(['--weird-dir'])).toThrow(/unknown argument: --weird-dir/i)
    })

    it('parseGraphSearchArgs treats dashed tokens after -- as positionals', () => {
        expect(parseGraphSearchArgs(['--', '--weird-dir', 'hello world'])).toEqual({
            projectRoot: '--weird-dir',
            query: 'hello world',
            topK: 10,
        })
    })

    it('parseGraphSearchArgs treats --top-k after -- as a literal query term', () => {
        expect(parseGraphSearchArgs(['/proj', '--', '--top-k'])).toEqual({
            projectRoot: '/proj',
            query: '--top-k',
            topK: 10,
        })
    })

    it('parseGraphSearchArgs still consumes --top-k as a flag before --', () => {
        expect(parseGraphSearchArgs(['/proj', 'query', '--top-k', '5'])).toEqual({
            projectRoot: '/proj',
            query: 'query',
            topK: 5,
        })
    })
})

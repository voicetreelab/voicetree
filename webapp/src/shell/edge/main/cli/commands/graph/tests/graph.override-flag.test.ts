import {describe, expect, it, vi} from 'vitest'
import {parseGraphCreateArgs} from '@/shell/edge/main/cli/commands/graph/core/args'
import type {ParsedLiveCreateArgs} from '@/shell/edge/main/cli/commands/graph/core/types'

class ExitCalled extends Error {
    constructor(public readonly code: number) { super(`process.exit(${code})`) }
}

function captureParse(args: string[]): {parsed?: unknown; stderr: string; exitCode: number | null} {
    const msgs: string[] = []
    const errSpy = vi.spyOn(console, 'error').mockImplementation((...v: unknown[]) => { msgs.push(v.join(' ')) })
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((c?: number) => {
        throw new ExitCalled(c ?? 0)
    }) as typeof process.exit)
    try {
        return {parsed: parseGraphCreateArgs(args), stderr: msgs.join('\n'), exitCode: null}
    } catch (err) {
        if (err instanceof ExitCalled) return {exitCode: err.code, stderr: msgs.join('\n')}
        throw err
    } finally {
        errSpy.mockRestore()
        exitSpy.mockRestore()
    }
}

describe('parseGraphCreateArgs --override', () => {
    it('accepts node_line_limit and grandparent_attachment, accumulating multiple', () => {
        const result = captureParse([
            '--node', 'T::S',
            '--override', 'node_line_limit:large diff',
            '--override', 'grandparent_attachment:cross-team context',
        ])
        expect(result.exitCode).toBeNull()
        expect((result.parsed as ParsedLiveCreateArgs).overrides).toEqual([
            {ruleId: 'node_line_limit', rationale: 'large diff'},
            {ruleId: 'grandparent_attachment', rationale: 'cross-team context'},
        ])
    })

    it('rejects an unknown ruleId', () => {
        const result = captureParse(['--node', 'T::S', '--override', 'unknown_rule:reason'])
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('not overridable')
    })

    it('rejects malformed values (missing rationale)', () => {
        const result = captureParse(['--node', 'T::S', '--override', 'node_line_limit:'])
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('--override')
    })

    it('rejects --override in filesystem mode (CLI gate is non-overridable)', () => {
        const result = captureParse(['some-file.md', '--override', 'node_line_limit:reason'])
        expect(result.exitCode).toBe(1)
        expect(result.stderr).toContain('only valid with live-mode')
    })
})

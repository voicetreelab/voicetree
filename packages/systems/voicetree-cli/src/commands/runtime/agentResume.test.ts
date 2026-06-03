import {afterEach, describe, expect, it, vi, type MockInstance} from 'vitest'
import {formatResumeResult, type ResumeOutcome} from './agentResumeFormat.ts'
import {agentResume} from './agent.ts'
import {CliError} from '../output.ts'

// `formatResumeResult` is the pure heart of `vt agent resume`: it maps a
// `ResumePersistedResult` payload (discriminated on `kind`) to the single line
// the user sees and whether the resume succeeded. We test it as a black box —
// record in, `{ok, message}` out — rather than mocking `callDaemon`, per the
// repo's functional-design / no-internal-mock rule.
describe('formatResumeResult — result-kind formatting', () => {
    it('maps `spawned` to an ok line naming the pid and command', () => {
        const outcome: ResumeOutcome = formatResumeResult('Amit', {
            kind: 'spawned',
            pid: 4242,
            command: 'claude --resume abc123',
        })
        expect(outcome.ok).toBe(true)
        expect(outcome.message).toContain('Amit')
        expect(outcome.message).toContain('4242')
        expect(outcome.message).toContain('claude --resume abc123')
    })

    it.each([
        ['already-claimed', /already holds this terminal/],
        ['no-resume-handle', /no resume handle/],
        ['not-in-discovery', /no recoverable session is in discovery/],
    ])('maps `stale` reason %s to a non-ok line', (reason, matcher) => {
        const outcome: ResumeOutcome = formatResumeResult('Amit', {kind: 'stale', reason})
        expect(outcome.ok).toBe(false)
        expect(outcome.message).toMatch(matcher)
        expect(outcome.message).toContain('Amit')
    })

    it('maps `no-native-session` to a non-ok line naming the CLI and reason', () => {
        const outcome: ResumeOutcome = formatResumeResult('Amit', {
            kind: 'no-native-session',
            cliType: 'claude',
            reason: 'no-transcript-found',
        })
        expect(outcome.ok).toBe(false)
        expect(outcome.message).toContain('claude')
        expect(outcome.message).toContain('no-transcript-found')
    })

    it('includes the diagnostic session id when present', () => {
        const outcome: ResumeOutcome = formatResumeResult('Amit', {
            kind: 'no-native-session',
            cliType: 'codex',
            reason: 'ambiguous-match',
            diagnosticSessionId: 'sess-99',
        })
        expect(outcome.message).toContain('sess-99')
    })

    it('maps `unsupported` to a non-ok line naming the reason', () => {
        const outcome: ResumeOutcome = formatResumeResult('Amit', {
            kind: 'unsupported',
            reason: 'gemini-not-supported',
        })
        expect(outcome.ok).toBe(false)
        expect(outcome.message).toContain('gemini-not-supported')
    })

    it('maps `spawn-failed` to a non-ok line carrying the error detail', () => {
        const outcome: ResumeOutcome = formatResumeResult('Amit', {
            kind: 'spawn-failed',
            error: 'tmux session create failed',
        })
        expect(outcome.ok).toBe(false)
        expect(outcome.message).toContain('tmux session create failed')
    })

    it('degrades an unrecognised kind to a non-ok line instead of throwing', () => {
        const outcome: ResumeOutcome = formatResumeResult('Amit', {kind: 'who-knows'})
        expect(outcome.ok).toBe(false)
        expect(outcome.message).toContain('who-knows')
    })
})

// Arg parsing runs entirely before any daemon call, so these paths need no
// network: a wrong positional count rejects, and `--help` prints usage and
// returns. Both observable via thrown CliError / captured stdout.
describe('agentResume — argument parsing', () => {
    afterEach(() => {
        vi.restoreAllMocks()
    })

    it('rejects when no terminal id is given', async () => {
        await expect(agentResume(undefined, [])).rejects.toBeInstanceOf(CliError)
    })

    it('rejects when more than one positional is given', async () => {
        await expect(agentResume(undefined, ['a', 'b'])).rejects.toBeInstanceOf(CliError)
    })

    it('rejects an unknown flag before reaching the daemon', async () => {
        await expect(agentResume(undefined, ['Amit', '--bogus'])).rejects.toBeInstanceOf(CliError)
    })

    it('prints usage for --help and returns without contacting the daemon', async () => {
        const logged: string[] = []
        const logSpy: MockInstance = vi
            .spyOn(console, 'log')
            .mockImplementation((...values: unknown[]): void => {
                logged.push(values.map((value: unknown): string => String(value)).join(' '))
            })

        await agentResume(undefined, ['--help'])

        logSpy.mockRestore()
        const output: string = logged.join('\n')
        expect(output).toContain('vt agent resume')
        expect(output).toContain('<terminalId>')
    })
})

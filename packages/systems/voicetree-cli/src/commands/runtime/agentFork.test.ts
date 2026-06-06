import {afterEach, describe, expect, it, vi, type Mock, type MockInstance} from 'vitest'
import {formatForkResult, type ForkOutcome} from './agentForkFormat.ts'
import {agentFork} from './agent.ts'
import {callDaemon} from '../daemon-client.ts'
import {CliError} from '../output.ts'

vi.mock('../daemon-client.ts', () => ({
    callDaemon: vi.fn(),
}))

const mockedCallDaemon: Mock = vi.mocked(callDaemon)

describe('formatForkResult — result-kind formatting', () => {
    it('maps `spawned` to an ok line naming source, forked terminal, pid, and command', () => {
        const outcome: ForkOutcome = formatForkResult('Amit', {
            kind: 'spawned',
            forkedTerminalId: 'Amit_1',
            pid: 4242,
            command: 'claude --resume abc123',
        })
        expect(outcome.ok).toBe(true)
        expect(outcome.message).toContain('Amit')
        expect(outcome.message).toContain('Amit_1')
        expect(outcome.message).toContain('4242')
        expect(outcome.message).toContain('claude --resume abc123')
    })

    it.each([
        ['no-resume-handle', /no resume handle/],
        ['not-in-discovery', /no recoverable session is in discovery/],
    ])('maps `stale` reason %s to a non-ok line', (reason, matcher) => {
        const outcome: ForkOutcome = formatForkResult('Amit', {kind: 'stale', reason})
        expect(outcome.ok).toBe(false)
        expect(outcome.message).toMatch(matcher)
        expect(outcome.message).toContain('Amit')
    })

    it('maps `no-native-session` to a non-ok line naming the CLI and reason', () => {
        const outcome: ForkOutcome = formatForkResult('Amit', {
            kind: 'no-native-session',
            cliType: 'claude',
            reason: 'no-transcript-found',
        })
        expect(outcome.ok).toBe(false)
        expect(outcome.message).toContain('claude')
        expect(outcome.message).toContain('no-transcript-found')
    })

    it('includes the diagnostic session id when present', () => {
        const outcome: ForkOutcome = formatForkResult('Amit', {
            kind: 'no-native-session',
            cliType: 'codex',
            reason: 'ambiguous-match',
            diagnosticSessionId: 'sess-99',
        })
        expect(outcome.message).toContain('sess-99')
    })

    it('maps `unsupported` to a non-ok line naming the reason', () => {
        const outcome: ForkOutcome = formatForkResult('Amit', {
            kind: 'unsupported',
            reason: 'gemini-not-supported',
        })
        expect(outcome.ok).toBe(false)
        expect(outcome.message).toContain('gemini-not-supported')
    })

    it('maps `spawn-failed` to a non-ok line carrying the error detail', () => {
        const outcome: ForkOutcome = formatForkResult('Amit', {
            kind: 'spawn-failed',
            error: 'tmux session create failed',
        })
        expect(outcome.ok).toBe(false)
        expect(outcome.message).toContain('tmux session create failed')
    })

    it('degrades an unrecognised kind to a non-ok line instead of throwing', () => {
        const outcome: ForkOutcome = formatForkResult('Amit', {kind: 'who-knows'})
        expect(outcome.ok).toBe(false)
        expect(outcome.message).toContain('who-knows')
    })
})

describe('agentFork — argument parsing and RPC wiring', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        mockedCallDaemon.mockReset()
    })

    it('defaults omitted source terminal id to the caller terminal id', async () => {
        mockedCallDaemon.mockResolvedValue({
            kind: 'spawned',
            forkedTerminalId: 'Raj_1',
            pid: 123,
            command: 'codex resume sess-1',
        })
        vi.spyOn(console, 'log').mockImplementation((): void => {})

        await agentFork('Raj', [])

        expect(mockedCallDaemon).toHaveBeenCalledWith('forkAgentSession', {sourceTerminalId: 'Raj'})
    })

    it('uses an explicit positional source terminal id when given', async () => {
        mockedCallDaemon.mockResolvedValue({
            kind: 'spawned',
            forkedTerminalId: 'Amit_1',
            pid: 123,
            command: 'claude --resume sess-1',
        })
        vi.spyOn(console, 'log').mockImplementation((): void => {})

        await agentFork('Raj', ['Amit'])

        expect(mockedCallDaemon).toHaveBeenCalledWith('forkAgentSession', {sourceTerminalId: 'Amit'})
    })

    it('does not require caller terminal id when an explicit source is given', async () => {
        mockedCallDaemon.mockResolvedValue({
            kind: 'spawned',
            forkedTerminalId: 'Amit_1',
            pid: 123,
            command: 'claude --resume sess-1',
        })
        vi.spyOn(console, 'log').mockImplementation((): void => {})

        await agentFork(undefined, ['Amit'])

        expect(mockedCallDaemon).toHaveBeenCalledWith('forkAgentSession', {sourceTerminalId: 'Amit'})
    })

    it('rejects when no caller terminal id is available for self-fork default', async () => {
        await expect(agentFork(undefined, [])).rejects.toBeInstanceOf(CliError)
        expect(mockedCallDaemon).not.toHaveBeenCalled()
    })

    it('rejects when more than one positional is given', async () => {
        await expect(agentFork('Raj', ['a', 'b'])).rejects.toBeInstanceOf(CliError)
        expect(mockedCallDaemon).not.toHaveBeenCalled()
    })

    it('rejects an unknown flag before reaching the daemon', async () => {
        await expect(agentFork('Raj', ['Amit', '--bogus'])).rejects.toBeInstanceOf(CliError)
        expect(mockedCallDaemon).not.toHaveBeenCalled()
    })

    it('prints usage for --help and returns without contacting the daemon', async () => {
        const logged: string[] = []
        const logSpy: MockInstance = vi
            .spyOn(console, 'log')
            .mockImplementation((...values: unknown[]): void => {
                logged.push(values.map((value: unknown): string => String(value)).join(' '))
            })

        await agentFork(undefined, ['--help'])

        logSpy.mockRestore()
        const output: string = logged.join('\n')
        expect(output).toContain('vt agent fork')
        expect(output).toContain('[terminalId]')
        expect(mockedCallDaemon).not.toHaveBeenCalled()
    })
})

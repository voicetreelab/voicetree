/**
 * Black-box table tests for the pure classifyExit decision function.
 * Locks the diagnostic logging contract for handleAgentExit:
 *   non-zero exit → error log
 *   clean exit with empty output → "ZERO output" warn
 *   clean exit with output but no spawned children → "missed handover" warn
 */
import {describe, it, expect} from 'vitest'
import type {TerminalId} from '@vt/vt-daemon/terminals/terminal-registry/types.ts'
import type {HeadlessLogEntry} from '../headlessAgentManager'
import {classifyExit, type ExitFacts} from '../headlessAgentLifecycle'

const TID = 'agent-x' as TerminalId

function facts(overrides: Partial<ExitFacts> = {}): ExitFacts {
    return {
        code: 0,
        output: '',
        spawnedChildren: false,
        terminalId: TID,
        ...overrides,
    }
}

describe('classifyExit', () => {
    describe('error exits (non-zero, non-null code)', () => {
        it('emits a single error entry with last 500 chars of output', () => {
            const longOutput: string = 'A'.repeat(600) + 'TAIL'
            const entries: readonly HeadlessLogEntry[] = classifyExit(
                facts({code: 7, output: longOutput, spawnedChildren: false}),
            )
            expect(entries).toHaveLength(1)
            expect(entries[0].level).toBe('error')
            expect(entries[0].message).toContain('exited with code 7')
            expect(entries[0].message).toContain('TAIL')
            expect(entries[0].message.length).toBeLessThan(longOutput.length)
        })

        it('does NOT also emit the missed-handover warn (only the error)', () => {
            const entries: readonly HeadlessLogEntry[] = classifyExit(
                facts({code: 137, output: 'real output here', spawnedChildren: false}),
            )
            expect(entries).toHaveLength(1)
            expect(entries[0].level).toBe('error')
        })

        it('treats whitespace-only output as no output (but still error)', () => {
            const entries: readonly HeadlessLogEntry[] = classifyExit(
                facts({code: 1, output: '   \n\t', spawnedChildren: false}),
            )
            expect(entries).toHaveLength(1)
            expect(entries[0].level).toBe('error')
        })
    })

    describe('zero-output clean exits', () => {
        it('emits ZERO-output warn when code=0 and output is empty', () => {
            const entries: readonly HeadlessLogEntry[] = classifyExit(
                facts({code: 0, output: ''}),
            )
            expect(entries).toHaveLength(1)
            expect(entries[0].level).toBe('warn')
            expect(entries[0].message).toContain('ZERO output')
        })

        it('emits ZERO-output warn when code=null (signal-killed) and output is empty', () => {
            const entries: readonly HeadlessLogEntry[] = classifyExit(
                facts({code: null, output: ''}),
            )
            expect(entries).toHaveLength(1)
            expect(entries[0].level).toBe('warn')
            expect(entries[0].message).toContain('ZERO output')
        })

        it('treats whitespace-only output as zero output', () => {
            const entries: readonly HeadlessLogEntry[] = classifyExit(
                facts({code: 0, output: '   \n  '}),
            )
            expect(entries).toHaveLength(1)
            expect(entries[0].level).toBe('warn')
            expect(entries[0].message).toContain('ZERO output')
        })
    })

    describe('missed-handover warn', () => {
        it('fires when code=0, output is non-empty, and no children spawned', () => {
            const entries: readonly HeadlessLogEntry[] = classifyExit(
                facts({code: 0, output: 'did stuff', spawnedChildren: false}),
            )
            expect(entries).toHaveLength(1)
            expect(entries[0].level).toBe('warn')
            expect(entries[0].message).toContain('missed handover')
        })

        it('does NOT fire when children were spawned', () => {
            const entries: readonly HeadlessLogEntry[] = classifyExit(
                facts({code: 0, output: 'did stuff', spawnedChildren: true}),
            )
            expect(entries).toHaveLength(0)
        })

        it('does NOT fire on signal exit (code=null) — only on explicit code=0', () => {
            const entries: readonly HeadlessLogEntry[] = classifyExit(
                facts({code: null, output: 'did stuff', spawnedChildren: false}),
            )
            // code=null + non-empty output: no ZERO-output warn AND no missed-handover (gated on code===0)
            expect(entries).toHaveLength(0)
        })
    })

    describe('no-decision cases', () => {
        it('returns empty when code=null, output non-empty, children spawned', () => {
            const entries: readonly HeadlessLogEntry[] = classifyExit(
                facts({code: null, output: 'work', spawnedChildren: true}),
            )
            expect(entries).toHaveLength(0)
        })

        it('returns empty when code=0, output non-empty, children spawned', () => {
            const entries: readonly HeadlessLogEntry[] = classifyExit(
                facts({code: 0, output: 'work', spawnedChildren: true}),
            )
            expect(entries).toHaveLength(0)
        })
    })

    describe('return shape', () => {
        it('always returns at most 1 entry for current inputs (error XOR zero-output XOR missed-handover)', () => {
            // Combinations from a small Cartesian product to assert no double-log path
            const codes: ReadonlyArray<number | null> = [0, null, 1, 137]
            const outputs: readonly string[] = ['', '   ', 'real']
            const childrenStates: readonly boolean[] = [true, false]
            for (const code of codes) {
                for (const output of outputs) {
                    for (const spawnedChildren of childrenStates) {
                        const entries: readonly HeadlessLogEntry[] = classifyExit(
                            facts({code, output, spawnedChildren}),
                        )
                        expect(entries.length).toBeLessThanOrEqual(1)
                    }
                }
            }
        })

        it('every emitted message references the terminalId', () => {
            const entries: readonly HeadlessLogEntry[] = classifyExit(
                facts({code: 9, output: 'x', terminalId: 'specific-id' as TerminalId}),
            )
            expect(entries[0].message).toContain('specific-id')
        })
    })
})

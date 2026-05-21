import {afterEach, describe, expect, it} from 'vitest'
import {
    __resetCliInvocationSinkForTests,
    buildCliInvocationRecord,
    emitInvocationStart,
    installCliInvocationSink,
    setErrorClass,
    setGateRejection,
    setInvocationContext,
    type CliInvocationRecord,
    type SinkDeps,
} from './recordCliInvocation'

afterEach(() => {
    __resetCliInvocationSinkForTests()
})

describe('buildCliInvocationRecord — pure shape transform', () => {
    const baseInput = {
        verb: 'graph create',
        argsShape: 'graph create --from-stdin --terminal=<redacted>',
        startMs: 1_000,
        endMs: 1_142,
        exitCode: 0,
        errorClass: null,
        gateRejection: null,
        terminalId: 'Ari',
        agentName: 'Vic',
        vtVersion: '0.42.1',
        nowIso: '2026-05-21T14:32:01.123Z',
        phase: 'end' as const,
    }

    it('builds a success record with computed duration_ms', () => {
        expect(buildCliInvocationRecord(baseInput)).toEqual({
            ts: '2026-05-21T14:32:01.123Z',
            verb: 'graph create',
            args_shape: 'graph create --from-stdin --terminal=<redacted>',
            exit_code: 0,
            duration_ms: 142,
            error_class: null,
            gate_rejection: null,
            agent: {terminalId: 'Ari', name: 'Vic'},
            vt_version: '0.42.1',
            phase: 'end',
        })
    })

    it('clamps negative durations to 0 (clock skew defence)', () => {
        const r: CliInvocationRecord = buildCliInvocationRecord({
            ...baseInput,
            startMs: 100,
            endMs: 50,
        })
        expect(r.duration_ms).toBe(0)
    })

    it('passes through error_class and gate_rejection unchanged', () => {
        const r: CliInvocationRecord = buildCliInvocationRecord({
            ...baseInput,
            exitCode: 1,
            errorClass: 'SchemaViolation',
            gateRejection: {
                typeName: 'forecast',
                schemaPath: '/vault/.voicetree/schemas/forecast.md',
                ruleIds: ['$.probability', '$.confidence'],
            },
        })
        expect(r.error_class).toBe('SchemaViolation')
        expect(r.gate_rejection).toEqual({
            typeName: 'forecast',
            schemaPath: '/vault/.voicetree/schemas/forecast.md',
            ruleIds: ['$.probability', '$.confidence'],
        })
    })

    it('emits null terminalId / name when not available', () => {
        const r: CliInvocationRecord = buildCliInvocationRecord({
            ...baseInput,
            terminalId: null,
            agentName: null,
        })
        expect(r.agent).toEqual({terminalId: null, name: null})
    })

    it('emits phase="start" verbatim', () => {
        const r: CliInvocationRecord = buildCliInvocationRecord({...baseInput, phase: 'start'})
        expect(r.phase).toBe('start')
    })
})

// =============================================================================
// Edge installer — deps-injected, drive synthetic exit
// =============================================================================

interface CapturedAppend {
    readonly filePath: string
    readonly line: string
}

interface SinkTestHarness {
    readonly appended: CapturedAppend[]
    readonly mkdirCalls: string[]
    readonly registeredHandlers: Array<() => void>
    readonly env: Map<string, string>
    readonly deps: SinkDeps
    fakeNow: number
    fakeNowIso: string
    fakeExitCode: number
}

function makeHarness(): SinkTestHarness {
    const appended: CapturedAppend[] = []
    const mkdirCalls: string[] = []
    const registeredHandlers: Array<() => void> = []
    const env: Map<string, string> = new Map()
    const harness: SinkTestHarness = {
        appended,
        mkdirCalls,
        registeredHandlers,
        env,
        fakeNow: 1_500,
        fakeNowIso: '2026-05-21T14:33:00.000Z',
        fakeExitCode: 0,
        deps: {
            appendFileSync: (filePath: string, line: string): void => {
                appended.push({filePath, line})
            },
            mkdirSync: (dir: string): void => {
                mkdirCalls.push(dir)
            },
            register: (handler: () => void): void => {
                registeredHandlers.push(handler)
            },
            now: (): number => harness.fakeNow,
            nowIso: (): string => harness.fakeNowIso,
            getEnv: (name: string): string | undefined => env.get(name),
            getExitCode: (): number => harness.fakeExitCode,
        },
    }
    return harness
}

describe('installCliInvocationSink — edge behaviour with injected deps', () => {
    it('registers an exit handler and creates the sink directory', () => {
        const h: SinkTestHarness = makeHarness()
        installCliInvocationSink({
            filePath: '/tmp/voicetree-test/cli-telemetry.jsonl',
            vtVersion: '0.0.1-test',
            startMs: 1_000,
            deps: h.deps,
        })

        expect(h.mkdirCalls).toEqual(['/tmp/voicetree-test'])
        expect(h.registeredHandlers).toHaveLength(1)
        expect(h.appended).toEqual([])
    })

    it('emits exactly one phase="end" record when the exit handler fires', () => {
        const h: SinkTestHarness = makeHarness()
        h.env.set('VOICETREE_TERMINAL_ID', 'Ari')
        h.env.set('AGENT_NAME', 'Vic')

        installCliInvocationSink({
            filePath: '/tmp/x/cli-telemetry.jsonl',
            vtVersion: '0.0.1-test',
            startMs: 1_000,
            deps: h.deps,
        })
        setInvocationContext({verb: 'help', argsShape: 'help'})

        h.fakeNow = 1_250
        h.fakeNowIso = '2026-05-21T14:33:00.250Z'
        h.fakeExitCode = 0

        h.registeredHandlers[0]()

        expect(h.appended).toHaveLength(1)
        const record: CliInvocationRecord = JSON.parse(h.appended[0].line.trimEnd())
        expect(record).toEqual({
            ts: '2026-05-21T14:33:00.250Z',
            verb: 'help',
            args_shape: 'help',
            exit_code: 0,
            duration_ms: 250,
            error_class: null,
            gate_rejection: null,
            agent: {terminalId: 'Ari', name: 'Vic'},
            vt_version: '0.0.1-test',
            phase: 'end',
        })
        expect(h.appended[0].line.endsWith('\n')).toBe(true)
        expect(h.appended[0].filePath).toBe('/tmp/x/cli-telemetry.jsonl')
    })

    it('propagates setErrorClass + non-zero exit_code into the record', () => {
        const h: SinkTestHarness = makeHarness()
        installCliInvocationSink({
            filePath: '/tmp/x/cli-telemetry.jsonl',
            vtVersion: '0.0.1-test',
            startMs: 1_000,
            deps: h.deps,
        })
        setInvocationContext({verb: 'graph structure', argsShape: 'graph structure --vault <arg>'})
        setErrorClass('DaemonUnreachableError')
        h.fakeNow = 1_058
        h.fakeNowIso = '2026-05-21T14:32:55.880Z'
        h.fakeExitCode = 3

        h.registeredHandlers[0]()

        const record: CliInvocationRecord = JSON.parse(h.appended[0].line)
        expect(record.exit_code).toBe(3)
        expect(record.error_class).toBe('DaemonUnreachableError')
        expect(record.gate_rejection).toBeNull()
        expect(record.duration_ms).toBe(58)
    })

    it('propagates setGateRejection into the record with ruleIds only (no messages)', () => {
        const h: SinkTestHarness = makeHarness()
        installCliInvocationSink({
            filePath: '/tmp/x/cli-telemetry.jsonl',
            vtVersion: '0.0.1-test',
            startMs: 1_000,
            deps: h.deps,
        })
        setInvocationContext({verb: 'graph create', argsShape: 'graph create <arg>'})
        setErrorClass('SchemaViolation')
        setGateRejection({
            typeName: 'forecast',
            schemaPath: '/vault/.voicetree/schemas/forecast.md',
            ruleIds: ['$.probability', '$.confidence'],
        })
        h.fakeExitCode = 1

        h.registeredHandlers[0]()

        const record: CliInvocationRecord = JSON.parse(h.appended[0].line)
        expect(record.error_class).toBe('SchemaViolation')
        expect(record.gate_rejection).toEqual({
            typeName: 'forecast',
            schemaPath: '/vault/.voicetree/schemas/forecast.md',
            ruleIds: ['$.probability', '$.confidence'],
        })
        // The full record JSON must not contain any violation message text.
        expect(h.appended[0].line).not.toMatch(/message/)
    })

    it('emits null agent fields when env is unset (headless invocation)', () => {
        const h: SinkTestHarness = makeHarness()
        installCliInvocationSink({
            filePath: '/tmp/x/cli-telemetry.jsonl',
            vtVersion: '0.0.1-test',
            startMs: 1_000,
            deps: h.deps,
        })
        setInvocationContext({verb: 'help', argsShape: 'help'})
        h.registeredHandlers[0]()

        const record: CliInvocationRecord = JSON.parse(h.appended[0].line)
        expect(record.agent).toEqual({terminalId: null, name: null})
    })

    it('emitInvocationStart writes a phase="start" record (for vt serve)', () => {
        const h: SinkTestHarness = makeHarness()
        h.env.set('VOICETREE_TERMINAL_ID', 'Ari')
        installCliInvocationSink({
            filePath: '/tmp/x/cli-telemetry.jsonl',
            vtVersion: '0.0.1-test',
            startMs: 1_000,
            deps: h.deps,
        })
        setInvocationContext({verb: 'serve', argsShape: 'serve --vault=<redacted>'})

        h.fakeNow = 1_300
        h.fakeNowIso = '2026-05-21T15:00:00.000Z'
        emitInvocationStart()

        expect(h.appended).toHaveLength(1)
        const start: CliInvocationRecord = JSON.parse(h.appended[0].line)
        expect(start.phase).toBe('start')
        expect(start.exit_code).toBe(0)
        expect(start.duration_ms).toBe(300)
        expect(start.agent.terminalId).toBe('Ari')

        // Now drive the exit; we should see a SECOND record (phase="end").
        h.fakeNow = 1_900
        h.fakeNowIso = '2026-05-21T15:00:00.600Z'
        h.fakeExitCode = 0
        h.registeredHandlers[0]()

        expect(h.appended).toHaveLength(2)
        const end: CliInvocationRecord = JSON.parse(h.appended[1].line)
        expect(end.phase).toBe('end')
        expect(end.duration_ms).toBe(900)
    })

    it('setErrorClass is write-once — first call wins; subsequent calls are ignored', () => {
        const h: SinkTestHarness = makeHarness()
        installCliInvocationSink({
            filePath: '/tmp/x/cli-telemetry.jsonl',
            vtVersion: '0.0.1-test',
            startMs: 1_000,
            deps: h.deps,
        })
        setInvocationContext({verb: 'debug', argsShape: 'debug <arg>'})
        setErrorClass('DebugSubprocessExit')
        setErrorClass('CliError')
        h.fakeExitCode = 1

        h.registeredHandlers[0]()

        const record: CliInvocationRecord = JSON.parse(h.appended[0].line)
        expect(record.exit_code).toBe(1)
        expect(record.error_class).toBe('DebugSubprocessExit')
    })

    it('emitInvocationStart is idempotent — calling twice emits only one start record', () => {
        const h: SinkTestHarness = makeHarness()
        installCliInvocationSink({
            filePath: '/tmp/x/cli-telemetry.jsonl',
            vtVersion: '0.0.1-test',
            startMs: 1_000,
            deps: h.deps,
        })
        setInvocationContext({verb: 'serve', argsShape: 'serve'})

        emitInvocationStart()
        emitInvocationStart()

        const starts: CapturedAppend[] = h.appended.filter((c) => JSON.parse(c.line).phase === 'start')
        expect(starts).toHaveLength(1)
    })
})

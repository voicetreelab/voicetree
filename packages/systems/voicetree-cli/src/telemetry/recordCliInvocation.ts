/**
 * One JSONL record per `vt` CLI process. Pure shape transform
 * `buildCliInvocationRecord` + edge installer `installCliInvocationSink` that
 * wires a single `process.on('exit')` handler to emit a record at exit.
 *
 * Per-process side-channel setters (`setErrorClass`, `setGateRejection`,
 * `setInvocationContext`, `emitInvocationStart`) update module-level state.
 * Module state is acceptable here because a CLI invocation is one-shot —
 * there is no concurrent invocation to contend with.
 *
 * Telemetry must never break the hot path: all I/O is wrapped in try/catch
 * and errors are swallowed. The exit handler uses `appendFileSync` because
 * `process.on('exit')` cannot await async I/O.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

export interface GateRejectionInfo {
    readonly typeName: string
    readonly schemaPath: string
    readonly ruleIds: readonly string[]
}

export interface CliInvocationRecord {
    readonly ts: string
    readonly verb: string
    readonly args_shape: string
    readonly exit_code: number
    readonly duration_ms: number
    readonly error_class: string | null
    readonly gate_rejection: GateRejectionInfo | null
    readonly agent: {
        readonly terminalId: string | null
        readonly name: string | null
    }
    readonly vt_version: string
    readonly phase: 'start' | 'end'
}

export interface BuildRecordInput {
    readonly verb: string
    readonly argsShape: string
    readonly startMs: number
    readonly endMs: number
    readonly exitCode: number
    readonly errorClass: string | null
    readonly gateRejection: GateRejectionInfo | null
    readonly terminalId: string | null
    readonly agentName: string | null
    readonly vtVersion: string
    readonly nowIso: string
    readonly phase: 'start' | 'end'
}

export function buildCliInvocationRecord(input: BuildRecordInput): CliInvocationRecord {
    return {
        ts: input.nowIso,
        verb: input.verb,
        args_shape: input.argsShape,
        exit_code: input.exitCode,
        duration_ms: Math.max(0, input.endMs - input.startMs),
        error_class: input.errorClass,
        gate_rejection: input.gateRejection,
        agent: {terminalId: input.terminalId, name: input.agentName},
        vt_version: input.vtVersion,
        phase: input.phase,
    }
}

// =============================================================================
// Edge: deps-injected sink installer
// =============================================================================

export interface SinkDeps {
    readonly appendFileSync: (filePath: string, line: string) => void
    readonly mkdirSync: (dir: string) => void
    readonly register: (handler: () => void) => void
    readonly now: () => number
    readonly nowIso: () => string
    readonly getEnv: (name: string) => string | undefined
    readonly getExitCode: () => number
}

export const defaultSinkDeps: SinkDeps = {
    appendFileSync: (filePath: string, line: string): void => {
        try {
            fs.appendFileSync(filePath, line)
        } catch {
            // Telemetry must never break the hot path.
        }
    },
    mkdirSync: (dir: string): void => {
        try {
            fs.mkdirSync(dir, {recursive: true})
        } catch {
            // best-effort; appendFileSync will swallow follow-on failures too.
        }
    },
    register: (handler: () => void): void => {
        process.on('exit', handler)
    },
    now: (): number => Number(process.hrtime.bigint() / 1_000_000n),
    nowIso: (): string => new Date().toISOString(),
    getEnv: (name: string): string | undefined => process.env[name],
    getExitCode: (): number => process.exitCode ?? 0,
}

interface SinkState {
    verb: string
    argsShape: string
    startMs: number
    errorClass: string | null
    gateRejection: GateRejectionInfo | null
    vtVersion: string
    filePath: string | null
    startEmitted: boolean
    deps: SinkDeps
}

const state: SinkState = makeInitialState()

function makeInitialState(): SinkState {
    return {
        verb: '(none)',
        argsShape: '',
        startMs: 0,
        errorClass: null,
        gateRejection: null,
        vtVersion: 'unknown',
        filePath: null,
        startEmitted: false,
        deps: defaultSinkDeps,
    }
}

export interface InstallSinkInput {
    readonly filePath: string
    readonly vtVersion: string
    readonly startMs: number
    readonly deps?: Partial<SinkDeps>
}

export function installCliInvocationSink(input: InstallSinkInput): void {
    const deps: SinkDeps = {...defaultSinkDeps, ...input.deps}
    state.filePath = input.filePath
    state.vtVersion = input.vtVersion
    state.startMs = input.startMs
    state.deps = deps
    deps.mkdirSync(path.dirname(input.filePath))
    deps.register((): void => emitEnd())
}

export function setInvocationContext(input: {verb: string; argsShape: string}): void {
    state.verb = input.verb
    state.argsShape = input.argsShape
}

export function setErrorClass(name: string): void {
    state.errorClass ??= name
}

export function setGateRejection(info: GateRejectionInfo): void {
    state.gateRejection = info
}

/**
 * Emit a phase="start" record. Used by long-running commands (`vt serve`) once
 * they enter their persistent loop, so launch frequency stays visible even if
 * the process crashes before clean shutdown.
 *
 * Idempotent: subsequent calls are no-ops.
 */
export function emitInvocationStart(): void {
    if (state.startEmitted) return
    if (state.filePath === null) return
    state.startEmitted = true
    const record: CliInvocationRecord = buildCliInvocationRecord({
        verb: state.verb,
        argsShape: state.argsShape,
        startMs: state.startMs,
        endMs: state.deps.now(),
        exitCode: 0,
        errorClass: null,
        gateRejection: null,
        terminalId: state.deps.getEnv('VOICETREE_TERMINAL_ID') ?? null,
        agentName: state.deps.getEnv('AGENT_NAME') ?? null,
        vtVersion: state.vtVersion,
        nowIso: state.deps.nowIso(),
        phase: 'start',
    })
    state.deps.appendFileSync(state.filePath, JSON.stringify(record) + '\n')
}

function emitEnd(): void {
    if (state.filePath === null) return
    const record: CliInvocationRecord = buildCliInvocationRecord({
        verb: state.verb,
        argsShape: state.argsShape,
        startMs: state.startMs,
        endMs: state.deps.now(),
        exitCode: state.deps.getExitCode(),
        errorClass: state.errorClass,
        gateRejection: state.gateRejection,
        terminalId: state.deps.getEnv('VOICETREE_TERMINAL_ID') ?? null,
        agentName: state.deps.getEnv('AGENT_NAME') ?? null,
        vtVersion: state.vtVersion,
        nowIso: state.deps.nowIso(),
        phase: 'end',
    })
    state.deps.appendFileSync(state.filePath, JSON.stringify(record) + '\n')
}

/** Test-only escape hatch — reset module state between tests. */
export function __resetCliInvocationSinkForTests(): void {
    const fresh: SinkState = makeInitialState()
    state.verb = fresh.verb
    state.argsShape = fresh.argsShape
    state.startMs = fresh.startMs
    state.errorClass = fresh.errorClass
    state.gateRejection = fresh.gateRejection
    state.vtVersion = fresh.vtVersion
    state.filePath = fresh.filePath
    state.startEmitted = fresh.startEmitted
    state.deps = fresh.deps
}

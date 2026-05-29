/**
 * Shared spawn → transcript → parse scaffold for harness drivers.
 *
 * Every CLI harness driver (claude, codex, …) runs the same impure shell:
 * spawn the child with stdout piped to a transcript file, arm a SIGKILL
 * timeout, await close, measure wall-clock, flush the transcript, then read
 * it back and hand the NDJSON to a harness-specific pure parser. Only the
 * command, the argv, and the parser differ — those are the `spec`.
 */
import {spawn} from 'node:child_process'
import {createWriteStream} from 'node:fs'
import {readFile} from 'node:fs/promises'
import {join} from 'node:path'
import type {HarnessDriver, RunTelemetry} from '../types.ts'

type RunOptions = Parameters<HarnessDriver['runScenario']>[0]
type RunResult = Awaited<ReturnType<HarnessDriver['runScenario']>>

/**
 * Per-harness variation: the binary to run, its argv, and the pure NDJSON
 * parser. The parser returns telemetry with `wallClockMs: 0` — this shell
 * overwrites it with the measured value.
 */
export type HarnessSpec = {
    readonly command: string
    readonly args: readonly string[]
    readonly parse: (ndjson: string) => {readonly telemetry: Omit<RunTelemetry, 'vtInvocationCount'>}
}

export async function runHarnessProcess(opts: RunOptions, spec: HarnessSpec): Promise<RunResult> {
    const transcriptPath = join(opts.artifactDir, 'transcript.jsonl')

    const start = Date.now()
    const child = spawn(spec.command, spec.args, {
        cwd: opts.cwd,
        env: {...opts.env},
        stdio: ['ignore', 'pipe', 'pipe'],
    })

    const transcriptStream = createWriteStream(transcriptPath)
    child.stdout.pipe(transcriptStream)
    child.stderr.resume()

    const timeoutHandle = setTimeout(() => {
        child.kill('SIGKILL')
    }, opts.timeoutMs)

    const exitInfo = await new Promise<RunResult['exitInfo']>((resolve) => {
        child.on('close', (code, signal) => {
            clearTimeout(timeoutHandle)
            resolve({code, signal})
        })
    })

    const wallClockMs = Date.now() - start

    await new Promise<void>((resolve) => {
        if (transcriptStream.closed) resolve()
        else transcriptStream.end(() => resolve())
    })

    const ndjson = await readFile(transcriptPath, 'utf8')
    const {telemetry} = spec.parse(ndjson)

    return {
        transcriptPath,
        telemetry: {...telemetry, wallClockMs},
        exitInfo,
    }
}

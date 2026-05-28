// One black-box e2e: spawn the real `bin/vt help` binary with
// VOICETREE_TELEMETRY_PATH pointed at a tmpdir, then read and assert on the
// JSONL record that gets written. Catches integration-level regressions:
// sink installation, exit-handler firing, path resolution, env reads.
//
// We assert on shape only (ISO regex, non-negative duration, expected verb),
// never on absolute timestamps or absolute filesystem paths.

import {spawn, type ChildProcess} from 'node:child_process'
import {mkdtemp, readFile, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {dirname, join, resolve} from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, beforeEach, describe, expect, it} from 'vitest'

const TEST_FILE_DIR: string = dirname(fileURLToPath(import.meta.url))
const PACKAGE_DIR: string = resolve(TEST_FILE_DIR, '../..')
const VT_BIN: string = join(PACKAGE_DIR, 'bin', 'vt')

const SPAWN_TIMEOUT_MS: number = 20_000
const ISO_REGEX: RegExp = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/

interface SpawnResult {
    code: number | null
    stdout: string
    stderr: string
}

function runVt(args: string[], env: Record<string, string>): Promise<SpawnResult> {
    return new Promise<SpawnResult>((resolvePromise, rejectPromise) => {
        const child: ChildProcess = spawn(VT_BIN, args, {
            cwd: tmpdir(),
            env,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []
        child.stdout?.on('data', (chunk: Buffer): void => {
            stdoutChunks.push(chunk)
        })
        child.stderr?.on('data', (chunk: Buffer): void => {
            stderrChunks.push(chunk)
        })

        const killTimer: NodeJS.Timeout = setTimeout(() => {
            child.kill('SIGKILL')
            rejectPromise(new Error(`vt ${args.join(' ')} timed out after ${SPAWN_TIMEOUT_MS}ms`))
        }, SPAWN_TIMEOUT_MS)
        child.on('error', (err: Error) => {
            clearTimeout(killTimer)
            rejectPromise(err)
        })
        child.on('close', (code: number | null) => {
            clearTimeout(killTimer)
            resolvePromise({
                code,
                stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                stderr: Buffer.concat(stderrChunks).toString('utf8'),
            })
        })
    })
}

function buildChildEnv(telemetryPath: string): Record<string, string> {
    const merged: Record<string, string | undefined> = {
        ...process.env,
        VOICETREE_TELEMETRY_PATH: telemetryPath,
        VOICETREE_TERMINAL_ID: 'e2e-terminal',
        AGENT_NAME: 'e2e-agent',
        // Force source-mode dispatch so the test exercises the live tsx path
        // rather than any locally built bundle in `dist/voicetree-cli.js`.
        VT_FORCE_SOURCE: '1',
    }
    delete merged.VT_SESSION
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(merged)) {
        if (value !== undefined) out[key] = value
    }
    return out
}

describe('cli-telemetry e2e — vt CLI writes a JSONL invocation record on exit', () => {
    let workDir: string
    let telemetryPath: string

    beforeEach(async () => {
        workDir = await mkdtemp(join(tmpdir(), 'vt-telemetry-e2e-'))
        telemetryPath = join(workDir, 'cli-telemetry.jsonl')
    })

    afterEach(async () => {
        await rm(workDir, {recursive: true, force: true})
    })

    it('writes one record for `vt help` with verb=help and exit_code=0', async () => {
        const result: SpawnResult = await runVt(['help'], buildChildEnv(telemetryPath))

        expect(result.code, `stderr: ${result.stderr}`).toBe(0)

        const raw: string = await readFile(telemetryPath, 'utf8')
        const lines: string[] = raw.split('\n').filter((l) => l.length > 0)
        expect(lines, `telemetry file content: ${raw}`).toHaveLength(1)

        const record: Record<string, unknown> = JSON.parse(lines[0])
        expect(record.verb).toBe('help')
        expect(record.exit_code).toBe(0)
        expect(record.error_class).toBeNull()
        expect(record.gate_rejection).toBeNull()
        expect(record.phase).toBe('end')

        // ISO 8601 timestamp shape — don't compare to wall clock.
        expect(record.ts).toMatch(ISO_REGEX)

        // Duration must be a non-negative finite number; don't pin a value.
        expect(typeof record.duration_ms).toBe('number')
        expect(Number.isFinite(record.duration_ms as number)).toBe(true)
        expect(record.duration_ms as number).toBeGreaterThanOrEqual(0)

        // Agent enrichment came from injected env vars (proves env path works).
        expect(record.agent).toEqual({terminalId: 'e2e-terminal', name: 'e2e-agent'})

        // Sink wrote to the file we pointed VOICETREE_TELEMETRY_PATH at —
        // relative-path assertion only, no absolute-path coupling.
        const writtenTo: string = telemetryPath
        expect(writtenTo.startsWith(workDir)).toBe(true)
    })
})

/**
 * Runner — the impure shell that drives one (scenario × model) cell.
 *
 * Pushes all I/O (temp dirs, process spawning, file reads) here so the
 * scoring pipeline stays pure. The runner orchestrates:
 *   1. setup() into a fresh temp working dir
 *   2. spawn the harness (claude --print) with PATH prepended by the shim dir
 *   3. load + merge the per-call shim log files produced by the agent's `vt` invocations
 *   4. delegate to pure scoring + the scenario's successCriteria
 *   5. emit a RunResult
 */
import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import {spawn} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {parseShimLog} from './shim-log.ts'
import {scoreScenario} from './scoring.ts'
import type {RunResult, ScenarioSpec, ShimLogEntry} from './types.ts'

export type RunOptions = {
    readonly scenario: ScenarioSpec
    readonly model: string                  // e.g. "sonnet", "haiku", "opus"
    readonly effort: 'low' | 'medium' | 'high'
    readonly realVtBin: string              // absolute path to real `vt`
    readonly workspaceRoot?: string         // for transcript naming; defaults to os.tmpdir
    readonly timeoutMs?: number             // hard cap per cell; defaults to 5 min
}

const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SHIM_BIN = path.join(PACKAGE_DIR, 'bin', 'vt-shim')

export async function runScenario(opts: RunOptions): Promise<RunResult> {
    const workspaceRoot = opts.workspaceRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'vt-bootcamp-')))
    const vaultDir = path.join(workspaceRoot, 'vault')
    const shimDir = path.join(workspaceRoot, 'shim')
    const shimLogDir = path.join(workspaceRoot, 'shim-log')
    const transcriptPath = path.join(workspaceRoot, 'transcript.txt')

    await fs.mkdir(vaultDir, {recursive: true})
    await fs.mkdir(shimDir, {recursive: true})
    await fs.mkdir(shimLogDir, {recursive: true})
    await fs.symlink(SHIM_BIN, path.join(shimDir, 'vt'))

    await opts.scenario.setup(vaultDir)

    const transcript = await invokeClaudeCode({
        prompt: opts.scenario.taskPrompt,
        model: opts.model,
        effort: opts.effort,
        cwd: vaultDir,
        shimDir,
        shimLogDir,
        realVtBin: opts.realVtBin,
        timeoutMs: opts.timeoutMs ?? 5 * 60_000,
    })
    await fs.writeFile(transcriptPath, transcript)

    const shimEntries = await loadShimEntries(shimLogDir)
    const {attempts, meanScore} = scoreScenario(opts.scenario.expectedCommands, shimEntries)
    const success = await opts.scenario.successCriteria(vaultDir)

    return {
        scenarioId: opts.scenario.id,
        model: opts.model,
        attempts,
        meanScore,
        success,
        shimLogDir,
        transcriptPath,
    }
}

/**
 * Load and merge all per-call shim log files into a single time-ordered list
 * of entries. Each file contains exactly one JSON entry (one line). Malformed
 * files are silently skipped — `parseShimLog` handles that.
 */
async function loadShimEntries(shimLogDir: string): Promise<readonly ShimLogEntry[]> {
    const files = await fs.readdir(shimLogDir)
    const jsonFiles = files.filter((f) => f.endsWith('.json'))
    const contents = await Promise.all(
        jsonFiles.map((f) => fs.readFile(path.join(shimLogDir, f), 'utf8'))
    )
    const entries = contents.flatMap((raw) => parseShimLog(raw))
    return [...entries].sort((a, b) => a.timestampMs - b.timestampMs)
}

type InvokeOptions = {
    readonly prompt: string
    readonly model: string
    readonly effort: 'low' | 'medium' | 'high'
    readonly cwd: string
    readonly shimDir: string
    readonly shimLogDir: string
    readonly realVtBin: string
    readonly timeoutMs: number
}

async function invokeClaudeCode(opts: InvokeOptions): Promise<string> {
    return new Promise((resolve, reject) => {
        const args = [
            '--print',
            '--model', opts.model,
            '--effort', opts.effort,
            '--permission-mode', 'bypassPermissions',
            '--output-format', 'text',
            opts.prompt,
        ]

        const childEnv = {
            ...process.env,
            PATH: `${opts.shimDir}:${process.env.PATH ?? ''}`,
            VT_SHIM_LOG_DIR: opts.shimLogDir,
            VT_REAL_BIN: opts.realVtBin,
        }

        const child = spawn('claude', args, {
            cwd: opts.cwd,
            env: childEnv,
            stdio: ['ignore', 'pipe', 'pipe'],
        })

        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []
        child.stdout.on('data', (chunk) => stdoutChunks.push(chunk))
        child.stderr.on('data', (chunk) => stderrChunks.push(chunk))

        const timer = setTimeout(() => {
            child.kill('SIGKILL')
            reject(new Error(`claude invocation timed out after ${opts.timeoutMs}ms`))
        }, opts.timeoutMs)

        child.on('error', (err) => {
            clearTimeout(timer)
            reject(err)
        })

        child.on('close', (code) => {
            clearTimeout(timer)
            const stdout = Buffer.concat(stdoutChunks).toString('utf8')
            const stderr = Buffer.concat(stderrChunks).toString('utf8')
            const transcript = stdout + (stderr ? `\n--- stderr ---\n${stderr}` : '')
            if (code !== 0) {
                // Don't reject — a non-zero claude exit is a valid agent outcome
                // (e.g. it gave up or hit a budget cap). We still want to score
                // whatever ran. Surface the exit code in the transcript.
                resolve(transcript + `\n--- claude exited with code ${code} ---\n`)
                return
            }
            resolve(transcript)
        })
    })
}

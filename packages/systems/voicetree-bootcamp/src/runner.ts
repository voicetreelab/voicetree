/**
 * Runner — the impure shell that drives one (scenario × model × rep) cell to
 * a CellResult.
 *
 * One deep impure function (`runScenario`) wraps the full pipeline:
 *   1. mkdtemp workspace (vault/, shim/, shim-log/, transcript)
 *   2. symlink the PATH shim so the agent's `vt` flows through the logger
 *   3. scenario.setup(vaultDir) materialises fixtures
 *   4. invoke the agent (headless: driver.runScenario | headful: vt agent spawn)
 *   5. merge per-call shim-log files, score, compute coverage + fitness
 *   6. scenario.teardown(vaultDir) in finally{} so it always runs
 *
 * All scoring lives in pure functions (scoring.ts) — the runner just plumbs
 * the data. The driver interface absorbs harness-specific churn; the runner
 * stays harness-agnostic.
 *
 * Headful mode is best-effort: it spawns the inner agent INSIDE the running
 * VoiceTree app via `vt agent spawn` so the user can WATCH the graph populate
 * live. Telemetry from VT-spawned agents is partial — see runHeadful() for
 * the documented gaps.
 */
import {spawn} from 'node:child_process'
import {promises as fs} from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import {fileURLToPath} from 'node:url'
import {computeCoverage, computeFitness, scoreScenario} from './scoring.ts'
import {parseShimLog} from './shim-log.ts'
import type {
    CellResult,
    Effort,
    HarnessDriver,
    RunTelemetry,
    ScenarioSpec,
    ShimLogEntry,
} from './types.ts'

const PACKAGE_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const SHIM_BIN = path.join(PACKAGE_DIR, 'bin', 'vt-shim')

/**
 * Monorepo default for the real `vt` binary the shim should delegate to.
 * Bootcamp lives at `packages/systems/voicetree-bootcamp/`; the CLI lives at
 * its sibling `voicetree-cli/bin/vt`. Callers can override via opts.realVtBin
 * (e.g. tests, out-of-tree consumers).
 */
const DEFAULT_REAL_VT_BIN = path.resolve(PACKAGE_DIR, '..', 'voicetree-cli', 'bin', 'vt')

export type RunMode = 'headless' | 'headful'

export type RunOptions = {
    readonly scenario: ScenarioSpec
    /**
     * Harness driver. Used in headless mode. In headful mode the runner
     * spawns the agent via `vt agent spawn` and ignores the driver, but the
     * field is still required so the call site is mode-symmetric.
     */
    readonly driver: HarnessDriver
    readonly model: string
    readonly effort: Effort
    readonly rep?: number
    /**
     * Absolute path to the real `vt` binary the shim should delegate to.
     * Defaults to the monorepo sibling `voicetree-cli/bin/vt`.
     */
    readonly realVtBin?: string
    readonly mode?: RunMode
    /**
     * Optional pre-created workspace dir. When omitted a fresh mkdtemp dir is
     * created. Passing one is mostly for tests that want to inspect artefacts.
     */
    readonly workspaceRoot?: string
    /** Hard cap on the inner agent invocation. Defaults to 10 minutes. */
    readonly timeoutMs?: number
    /**
     * Headful only — VT node id to spawn the inner agent under. Required for
     * headful mode (no clean way to spawn under a fresh vault root from CLI).
     */
    readonly headfulParentNodeId?: string
    /**
     * Headful only — `vt agent spawn`'s `--terminal` (caller terminal id).
     * The CLI requires this to attribute the spawn to a caller; when the
     * bootcamp is launched from a non-VT shell there is no caller terminal,
     * so the user must supply one (the id of any open VT terminal).
     * Falls back to `$VOICETREE_TERMINAL_ID` when omitted.
     */
    readonly headfulCallerTerminalId?: string
    /**
     * Headful only — attempt `open -a Voicetree` before spawning so the user
     * sees the app come up. Best-effort; no-op if Voicetree.app is missing.
     */
    readonly launchApp?: boolean
}

export async function runScenario(opts: RunOptions): Promise<CellResult> {
    const mode: RunMode = opts.mode ?? 'headless'
    const rep = opts.rep ?? 0
    const timeoutMs = opts.timeoutMs ?? 10 * 60_000
    const realVtBin = opts.realVtBin ?? DEFAULT_REAL_VT_BIN

    const workspaceRoot =
        opts.workspaceRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'vt-bootcamp-')))
    const vaultDir = path.join(workspaceRoot, 'vault')
    const shimDir = path.join(workspaceRoot, 'shim')
    const shimLogDir = path.join(workspaceRoot, 'shim-log')
    const transcriptDefaultPath = path.join(workspaceRoot, 'transcript.txt')

    await fs.mkdir(vaultDir, {recursive: true})
    await fs.mkdir(shimDir, {recursive: true})
    await fs.mkdir(shimLogDir, {recursive: true})
    await fs.symlink(SHIM_BIN, path.join(shimDir, 'vt'))

    await opts.scenario.setup(vaultDir)

    try {
        const env: Record<string, string> = {
            ...currentEnvAsStrings(),
            PATH: `${shimDir}:${process.env.PATH ?? ''}`,
            VT_SHIM_LOG_DIR: shimLogDir,
            VT_REAL_BIN: realVtBin,
        }

        const driverResult =
            mode === 'headless'
                ? await opts.driver.runScenario({
                      model: opts.model,
                      effort: opts.effort,
                      prompt: opts.scenario.taskPrompt,
                      cwd: vaultDir,
                      env,
                      timeoutMs,
                      artifactDir: workspaceRoot,
                  })
                : await runHeadful({
                      prompt: opts.scenario.taskPrompt,
                      cwd: vaultDir,
                      env,
                      timeoutMs,
                      transcriptPath: transcriptDefaultPath,
                      realVtBin,
                      parentNodeId: opts.headfulParentNodeId,
                      callerTerminalId: opts.headfulCallerTerminalId,
                      launchApp: opts.launchApp ?? false,
                  })

        const shimEntries = await loadShimEntries(shimLogDir)
        const {attempts} = scoreScenario(opts.scenario.expectedCommands, shimEntries)
        const success = await opts.scenario.successCriteria(vaultDir)
        const coverage = computeCoverage(opts.scenario.expectedCommands, shimEntries)

        const telemetry: RunTelemetry = {
            ...driverResult.telemetry,
            vtInvocationCount: shimEntries.length,
        }

        const breakdown = computeFitness({
            attempts,
            shimLog: shimEntries,
            expected: opts.scenario.expectedCommands,
            telemetry,
            budgets: opts.scenario.budgets,
            success,
        })

        return {
            scenarioId: opts.scenario.id,
            model: opts.model,
            rep,
            telemetry,
            shimLogPath: shimLogDir,
            transcriptPath: driverResult.transcriptPath,
            attempts,
            success,
            coverage,
            breakdown,
        }
    } finally {
        if (opts.scenario.teardown) {
            await opts.scenario.teardown(vaultDir).catch(() => {})
        }
    }
}

/**
 * Load every per-call .json file from the shim-log dir and return one
 * time-ordered list. The shim writes one entry per file (atomic by
 * construction), so concurrent agent calls cannot interleave.
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

function currentEnvAsStrings(): Record<string, string> {
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(process.env)) {
        if (typeof v === 'string') out[k] = v
    }
    return out
}

type HeadfulOpts = {
    readonly prompt: string
    readonly cwd: string
    readonly env: Readonly<Record<string, string>>
    readonly timeoutMs: number
    readonly transcriptPath: string
    readonly realVtBin: string
    readonly parentNodeId: string | undefined
    readonly callerTerminalId: string | undefined
    readonly launchApp: boolean
}

type DriverShape = {
    readonly transcriptPath: string
    readonly telemetry: Omit<RunTelemetry, 'vtInvocationCount'>
    readonly exitInfo: {readonly code: number | null; readonly signal: NodeJS.Signals | null}
}

/**
 * Headful invocation — spawn the inner agent INSIDE the running VoiceTree app
 * via `vt agent spawn` so the user can watch the graph populate live.
 *
 * KNOWN GAPS (this branch's `vt` CLI; surfaced honestly rather than papered over):
 *   1. No `vt vault open <path>` / `vt app launch` verb. Best we can do is
 *      `open -a Voicetree` — the app picks up its last-opened vault, not the
 *      one we just mkdtemp'd. Caller is expected to point the app at vaultDir
 *      manually (or run headless if that's untenable).
 *   2. `vt agent spawn` has no `--env` flag, so the inner agent's PATH cannot
 *      be guaranteed to include our shim dir. The runner sets PATH on its OWN
 *      env when invoking `vt agent spawn`, but whether the daemon-owned PTY
 *      inherits that depends on daemon internals — likely brittle.
 *   3. `vt agent spawn --task ... --parent <id>` requires an existing parent
 *      node id. There is no convention for "vault root id" exposed at the
 *      CLI, so the caller must supply one (`headfulParentNodeId`).
 *   4. Token-level telemetry from VT-spawned agents is not surfaced by
 *      `vt agent output` — only the last N chars of the terminal buffer.
 *      Returned telemetry has inputTokens/outputTokens/toolCallCount = 0.
 *      wallClockMs is measured by the runner.
 *
 * Headful's PRIMARY value is WATCHING, not benchmarking (per the task brief).
 */
async function runHeadful(opts: HeadfulOpts): Promise<DriverShape> {
    if (!opts.parentNodeId) {
        throw new Error(
            'runHeadful: headfulParentNodeId is required — `vt agent spawn` ' +
                "cannot attach to a fresh vault without a parent node id. " +
                "Pass headfulParentNodeId, or use mode='headless'.",
        )
    }

    const callerTerminalId = opts.callerTerminalId ?? opts.env.VOICETREE_TERMINAL_ID
    if (!callerTerminalId) {
        throw new Error(
            'runHeadful: a caller terminal id is required — `vt agent spawn` ' +
                'attributes spawns to a caller. Pass headfulCallerTerminalId ' +
                '(the id of any open VT terminal), or set $VOICETREE_TERMINAL_ID ' +
                "before running, or use mode='headless'.",
        )
    }

    if (opts.launchApp) {
        await bestEffortLaunchApp()
    }

    const start = Date.now()
    const spawnRes = await execCapture(
        opts.realVtBin,
        [
            'agent', 'spawn',
            '--terminal', callerTerminalId,
            '--task', opts.prompt,
            '--parent', opts.parentNodeId,
        ],
        {cwd: opts.cwd, env: opts.env, timeoutMs: 30_000},
    )
    if (spawnRes.exitCode !== 0) {
        throw new Error(
            `runHeadful: \`vt agent spawn\` exited ${spawnRes.exitCode}: ` +
                `${spawnRes.stderr.trim() || spawnRes.stdout.trim()}`,
        )
    }
    const terminalId = extractTerminalId(spawnRes.stdout)
    if (!terminalId) {
        throw new Error(
            `runHeadful: could not parse terminal id from \`vt agent spawn\` ` +
                `output: ${spawnRes.stdout}`,
        )
    }

    await pollUntilAgentDone({
        realVtBin: opts.realVtBin,
        cwd: opts.cwd,
        env: opts.env,
        terminalId,
        deadlineMs: start + opts.timeoutMs,
    })
    const wallClockMs = Date.now() - start

    const outputRes = await execCapture(
        opts.realVtBin,
        ['agent', 'output', terminalId, '--chars', '200000'],
        {cwd: opts.cwd, env: opts.env, timeoutMs: 30_000},
    )
    await fs.writeFile(opts.transcriptPath, outputRes.stdout)

    return {
        transcriptPath: opts.transcriptPath,
        telemetry: {inputTokens: 0, outputTokens: 0, toolCallCount: 0, wallClockMs},
        exitInfo: {code: 0, signal: null},
    }
}

async function bestEffortLaunchApp(): Promise<void> {
    await new Promise<void>((resolve) => {
        const child = spawn('open', ['-a', 'Voicetree'], {stdio: 'ignore'})
        child.on('close', () => resolve())
        child.on('error', () => resolve())
    })
}

/**
 * Extract the spawned agent's terminal id from `vt agent spawn` stdout. The
 * CLI prints a human-readable line containing the id; we look for the first
 * token that matches the conventional id shape and fall back to undefined if
 * none is found (the caller surfaces the raw output in the error).
 */
function extractTerminalId(stdout: string): string | undefined {
    const jsonMatch = stdout.match(/"terminalId"\s*:\s*"([^"]+)"/)
    if (jsonMatch) return jsonMatch[1]
    const labelMatch = stdout.match(/terminal(?:Id)?\s*[:=]\s*([A-Za-z0-9._-]+)/i)
    if (labelMatch) return labelMatch[1]
    return undefined
}

async function pollUntilAgentDone(opts: {
    readonly realVtBin: string
    readonly cwd: string
    readonly env: Readonly<Record<string, string>>
    readonly terminalId: string
    readonly deadlineMs: number
}): Promise<void> {
    while (Date.now() < opts.deadlineMs) {
        const list = await execCapture(opts.realVtBin, ['agent', 'list', '--json'], {
            cwd: opts.cwd,
            env: opts.env,
            timeoutMs: 10_000,
        })
        if (agentFinishedInListJson(list.stdout, opts.terminalId)) return
        await sleep(5_000)
    }
    throw new Error(`runHeadful: agent ${opts.terminalId} did not finish before timeout`)
}

/**
 * Parse `vt agent list --json` output to decide whether a given terminal has
 * finished. Treats "running"/"pending" as still-active; anything else (or
 * absent from the list) as done.
 */
export function agentFinishedInListJson(json: string, terminalId: string): boolean {
    let parsed: unknown
    try {
        parsed = JSON.parse(json)
    } catch {
        return false
    }
    const agents = extractAgentEntries(parsed)
    if (agents.length === 0) return true
    const match = agents.find((a) => a.terminalId === terminalId)
    if (!match) return true
    const status = (match.status ?? '').toLowerCase()
    return status !== 'running' && status !== 'pending' && status !== 'active'
}

function extractAgentEntries(
    value: unknown,
): readonly {readonly terminalId?: string; readonly status?: string}[] {
    if (Array.isArray(value)) {
        return value.filter(isAgentLike)
    }
    if (typeof value === 'object' && value !== null) {
        const v = value as Record<string, unknown>
        if (Array.isArray(v.agents)) return v.agents.filter(isAgentLike)
        if (Array.isArray(v.terminals)) return v.terminals.filter(isAgentLike)
    }
    return []
}

function isAgentLike(v: unknown): v is {terminalId?: string; status?: string} {
    return typeof v === 'object' && v !== null
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
}

type ExecResult = {
    readonly stdout: string
    readonly stderr: string
    readonly exitCode: number | null
}

async function execCapture(
    bin: string,
    args: readonly string[],
    opts: {
        readonly cwd: string
        readonly env: Readonly<Record<string, string>>
        readonly timeoutMs: number
    },
): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(bin, [...args], {
            cwd: opts.cwd,
            env: opts.env as NodeJS.ProcessEnv,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        const stdoutChunks: Buffer[] = []
        const stderrChunks: Buffer[] = []
        child.stdout.on('data', (c) => stdoutChunks.push(c))
        child.stderr.on('data', (c) => stderrChunks.push(c))
        const timer = setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs)
        child.on('error', (err) => {
            clearTimeout(timer)
            reject(err)
        })
        child.on('close', (code) => {
            clearTimeout(timer)
            resolve({
                stdout: Buffer.concat(stdoutChunks).toString('utf8'),
                stderr: Buffer.concat(stderrChunks).toString('utf8'),
                exitCode: code,
            })
        })
    })
}

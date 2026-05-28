/**
 * Runner — the impure shell that drives one (scenario × model × rep) cell to
 * a CellResult.
 *
 * One deep impure function (`runScenario`) wraps the full pipeline:
 *   1. mkdtemp workspace (vault/, shim/, shim-log/)
 *   2. symlink the PATH shim so the agent's `vt` flows through the logger
 *   3. headful only: launch VoiceTree pointing at vaultDir + wait for daemon
 *   4. scenario.setup(vaultDir) materialises fixtures (VT watcher fires if open)
 *   5. driver.runScenario — same path for headless and headful; the diff is
 *      whether VT is open and watching
 *   6. merge per-call shim-log files, score, compute coverage + fitness
 *   7. scenario.teardown(vaultDir) in finally{} so it always runs
 *
 * All scoring lives in pure functions (scoring.ts) — the runner just plumbs
 * the data. The driver interface absorbs harness-specific churn; the runner
 * stays harness-agnostic.
 *
 * Headful is "headless + a VT window watching the vault". The agent process
 * is identical (external claude-code, same PATH-shim, same env); VT picks up
 * the file writes through its normal watcher. This means full telemetry is
 * preserved (driver returns real token counts) and there are no caller-
 * terminal / parent-node ergonomic gaps. The user just sees the graph
 * populate in real time.
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
     * created. Passing one is mostly for tests that want to inspect artefacts,
     * or for headful runs where the user wants a stable path.
     */
    readonly workspaceRoot?: string
    /** Hard cap on the inner agent invocation. Defaults to 10 minutes. */
    readonly timeoutMs?: number
    /**
     * Headful only — how long to wait for the per-vault VTD to write its
     * rpc.port discovery file before giving up. Defaults to 60s; raise if
     * the machine is slow to launch Electron.
     */
    readonly headfulDaemonReadyTimeoutMs?: number
    /**
     * Headful only — overrides for the two impure helpers, so tests can
     * exercise the orchestration without actually launching Electron or
     * polling the filesystem. Production callers should leave these unset
     * and get the real implementations.
     */
    readonly launchVoicetreeApp?: (vaultDir: string) => Promise<void>
    readonly waitForDaemonReady?: (vaultDir: string, timeoutMs: number) => Promise<void>
}

export async function runScenario(opts: RunOptions): Promise<CellResult> {
    const mode: RunMode = opts.mode ?? 'headless'
    const rep = opts.rep ?? 0
    const timeoutMs = opts.timeoutMs ?? 10 * 60_000
    const daemonReadyTimeoutMs = opts.headfulDaemonReadyTimeoutMs ?? 60_000
    const realVtBin = opts.realVtBin ?? DEFAULT_REAL_VT_BIN
    const launchApp = opts.launchVoicetreeApp ?? launchVoicetreeAppDefault
    const waitDaemon = opts.waitForDaemonReady ?? waitForDaemonReadyDefault

    const workspaceRoot =
        opts.workspaceRoot ?? (await fs.mkdtemp(path.join(os.tmpdir(), 'vt-bootcamp-')))
    const vaultDir = path.join(workspaceRoot, 'vault')
    const shimDir = path.join(workspaceRoot, 'shim')
    const shimLogDir = path.join(workspaceRoot, 'shim-log')

    await fs.mkdir(vaultDir, {recursive: true})
    await fs.mkdir(shimDir, {recursive: true})
    await fs.mkdir(shimLogDir, {recursive: true})
    await fs.symlink(SHIM_BIN, path.join(shimDir, 'vt'))

    // Headful: open VT pointing at the empty vault BEFORE we copy fixtures so
    // the user sees them appear in the graph in real time. Wait for the
    // per-vault VTD to write rpc.port — that's the daemon-ready signal that
    // the app's watcher is wired up. Both the bootcamp's shim'd `vt` calls
    // and the Electron app converge on this one daemon (BF-348 single-flight),
    // so the agent's graph mutations reach VT's renderer through the same RPC.
    if (mode === 'headful') {
        await launchApp(vaultDir)
        await waitDaemon(vaultDir, daemonReadyTimeoutMs)
    }

    await opts.scenario.setup(vaultDir)

    try {
        const env: Record<string, string> = {
            ...currentEnvAsStrings(),
            PATH: `${shimDir}:${process.env.PATH ?? ''}`,
            VT_SHIM_LOG_DIR: shimLogDir,
            VT_REAL_BIN: realVtBin,
        }

        const driverResult = await opts.driver.runScenario({
            model: opts.model,
            effort: opts.effort,
            prompt: opts.scenario.taskPrompt,
            cwd: vaultDir,
            env,
            timeoutMs,
            artifactDir: workspaceRoot,
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

/**
 * Launch the Voicetree Electron app pointed at vaultDir, using the documented
 * `--open-folder <path>` argv handler. Always opens a fresh instance (`-na`)
 * so we don't fight an already-open vault: the `--open-folder` flag is read
 * once at app startup, so reusing a running instance silently drops the
 * argument and lands the user in their previous vault.
 */
async function launchVoicetreeAppDefault(vaultDir: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(
            'open',
            ['-na', 'Voicetree', '--args', '--open-folder', vaultDir],
            {stdio: 'ignore'},
        )
        child.on('error', reject)
        child.on('exit', (code) => {
            if (code === 0) return resolve()
            reject(
                new Error(
                    'launchVoicetreeApp: `open -na Voicetree` exited ' +
                        `${code}. Is /Applications/Voicetree.app installed?`,
                ),
            )
        })
    })
}

/**
 * Poll for the per-vault VTD's discovery file at `<vault>/.voicetree/rpc.port`.
 * The Electron app spawns one VTD per opened vault; the daemon writes rpc.port
 * once it's accepting connections. Appearance of that file is the canonical
 * "daemon ready" signal — the same signal the CLI's daemon-url-binding uses
 * to discover a running peer.
 */
async function waitForDaemonReadyDefault(vaultDir: string, timeoutMs: number): Promise<void> {
    const rpcPortPath = path.join(vaultDir, '.voicetree', 'rpc.port')
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        try {
            await fs.stat(rpcPortPath)
            return
        } catch {
            // not yet — fallthrough to sleep
        }
        await sleep(500)
    }
    throw new Error(
        `waitForDaemonReady: ${rpcPortPath} did not appear within ${timeoutMs}ms. ` +
            'Is the Voicetree app installed and able to open this vault path?',
    )
}

async function sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms))
}

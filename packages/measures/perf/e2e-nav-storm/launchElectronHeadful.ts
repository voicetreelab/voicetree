/**
 * Headful Electron launch for e2e-nav-storm.
 *
 * Deliberately does NOT pass `--open-folder`: that startup path creates a dated
 * `voicetree-<date>/` write-subfolder and projects only that, so a pre-seeded
 * project never renders. Instead the harness opens the project AFTER launch via
 * `window.hostAPI.main.openProject(projectDir)`, which honours the saved
 * `writeFolderPath` (= projectDir, written by seedUserData) and loads ALL `.md`
 * — the same recipe the 500-node realistic-perf e2e uses. The daemon is spawned
 * by that open call, so readiness is gated downstream on the rendered graph, not
 * on a launch-time `.voicetree/rpc.port` that wouldn't exist yet.
 *
 * HEADFUL (real GPU on the Mac) is driven by `extraEnv` (HEADLESS_TEST=0 /
 * MINIMIZE_TEST=0 from runContext). Pure shell — impurity (child process) here.
 */
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import * as path from 'node:path'
import * as os from 'node:os'
import { existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { seedUserData } from '../e2e-storm-mvp/launchElectron.ts'

export interface HeadfulLaunchInputs {
    readonly repoRoot: string
    readonly projectDir: string
    readonly voicetreeHomePath: string
    readonly logFilePath: string
    readonly inspectPort: number
    readonly extraEnv?: Readonly<Record<string, string>>
}

export interface HeadfulLaunchResult {
    readonly app: ElectronApplication
    readonly bootMs: number
}

function canLoadNativeGraphDbModules(nodeBin: string, projectRoot: string): boolean {
    try {
        execFileSync(
            nodeBin,
            ['-e', "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(':memory:').close()"],
            { cwd: projectRoot, stdio: 'ignore' },
        )
        return true
    } catch {
        return false
    }
}

function resolveGraphDaemonNodeBin(repoRoot: string): string {
    const nvmNodeBin = path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.20.0', 'bin', 'node')
    const candidates = [
        process.env.VT_GRAPHD_NODE_BIN,
        process.env.npm_node_execpath,
        process.execPath,
        existsSync(nvmNodeBin) ? nvmNodeBin : undefined,
        'node',
    ].filter((c): c is string => Boolean(c))
    return candidates.find(bin => canLoadNativeGraphDbModules(bin, repoRoot)) ?? process.execPath
}

/**
 * Hermetic base env: drop every inherited VoiceTree/agent variable so the
 * launched app resolves ITS project (--open-folder) and ITS home (--user-data-dir),
 * not the project of the agent terminal this harness runs inside. Without this,
 * a leaked VOICETREE_HOME_PATH / VOICETREE_PROJECT_PATH / VOICETREE_DAEMON_URL
 * hijacks the daemon onto the orchestrator's own graph (observed: the projected
 * graph showed the mindmap's nodes, not the 1000 seeded ones). The caller-set
 * perf vars (run id, OTLP endpoint, perf-probe) are re-applied via extraEnv.
 */
function hermeticBaseEnv(): Record<string, string | undefined> {
    const result: Record<string, string | undefined> = {}
    for (const [key, value] of Object.entries(process.env)) {
        if (key.startsWith('VOICETREE_') || key.startsWith('AGENT_')) continue
        if (key === 'CONTEXT_NODE_PATH' || key === 'TASK_NODE_PATH' || key === 'DEPTH_BUDGET') continue
        if (key === 'VT_GRAPHD_NODE_BIN' || key === 'ELECTRON_RENDERER_URL') continue
        result[key] = value
    }
    return result
}

export async function launchElectronHeadful(inputs: HeadfulLaunchInputs): Promise<HeadfulLaunchResult> {
    seedUserData(inputs.voicetreeHomePath, inputs.projectDir)

    const mainEntry = path.join(inputs.repoRoot, 'webapp', 'dist-electron', 'main', 'index.js')
    if (!existsSync(mainEntry)) {
        throw new Error(`electron main bundle not found at ${mainEntry} — run electron-vite build first`)
    }

    const bootStart = Date.now()
    const app = await electron.launch({
        args: [
            `--inspect=${inputs.inspectPort}`,
            mainEntry,
            `--user-data-dir=${inputs.voicetreeHomePath}`,
        ],
        env: {
            ...hermeticBaseEnv(),
            NODE_ENV: 'test',
            HEADLESS_TEST: process.env.HEADLESS_TEST ?? '1',
            MINIMIZE_TEST: process.env.MINIMIZE_TEST ?? '0',
            VOICETREE_PERSIST_STATE: '1',
            VOICETREE_DAEMON_LOAD_TIMEOUT_MS: '180000',
            VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(inputs.repoRoot),
            // resolveVoicetreeHomePath() honours VOICETREE_HOME_PATH (not
            // --user-data-dir), so the isolated home where seedUserData wrote
            // the projectConfig (writeFolderPath=projectDir) must be named here,
            // or openProject reads ~/.voicetree, misses the config, and creates
            // a dated write-subfolder that projects only itself.
            VOICETREE_HOME_PATH: inputs.voicetreeHomePath,
            ...(inputs.extraEnv ?? {}),
        },
        timeout: 60_000,
    })
    const bootMs = Date.now() - bootStart

    const logChunks: string[] = []
    const writeLog = (): void => {
        try { writeFileSync(inputs.logFilePath, logChunks.join(''), 'utf8') } catch { /* best effort */ }
    }
    app.process().stdout?.on('data', (c: Buffer) => { logChunks.push(c.toString('utf8')); writeLog() })
    app.process().stderr?.on('data', (c: Buffer) => { logChunks.push(c.toString('utf8')); writeLog() })

    return { app, bootMs }
}

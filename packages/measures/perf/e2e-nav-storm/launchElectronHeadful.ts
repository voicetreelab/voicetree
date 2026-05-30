/**
 * Headful Electron launch for e2e-nav-storm — waits on the daemon's REAL
 * readiness signal (`<project>/.voicetree/rpc.port`), not the dead `.mcp.json`
 * discovery file the e2e-storm-mvp launcher polls. This worktree's daemon serves
 * `/rpc` (rpc.port + auth-token) and never writes `.mcp.json`, so a `.mcp.json`
 * wait hangs forever. nav-storm needs no MCP at all: its trickle writes go
 * straight to the watched folder and it gates readiness on the rendered graph.
 *
 * Boots `dist-electron/main/index.js` with `--open-folder` so the project picker
 * is bypassed. HEADFUL (real GPU on the Mac) is driven by `extraEnv`
 * (HEADLESS_TEST=0 / MINIMIZE_TEST=0 from runContext). Pure shell — impurity
 * (child process, fs polling) is concentrated here.
 */
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import * as path from 'node:path'
import * as os from 'node:os'
import { existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { rpcPortFilePath } from '@vt/vt-rpc'
import { seedUserData } from '../e2e-storm-mvp/launchElectron.ts'

export interface HeadfulLaunchInputs {
    readonly repoRoot: string
    readonly projectDir: string
    readonly voicetreeHomePath: string
    readonly logFilePath: string
    readonly inspectPort: number
    readonly daemonReadyTimeoutMs: number
    readonly extraEnv?: Readonly<Record<string, string>>
}

export interface HeadfulLaunchResult {
    readonly app: ElectronApplication
    readonly bootMs: number
    readonly daemonReadyMs: number
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

async function pollExists(filePath: string, timeoutMs: number, intervalMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (existsSync(filePath)) return
        await new Promise(r => setTimeout(r, intervalMs))
    }
    throw new Error(`daemon readiness file not found within ${timeoutMs}ms: ${filePath}`)
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
            '--open-folder',
            inputs.projectDir,
        ],
        env: {
            ...process.env,
            NODE_ENV: 'test',
            HEADLESS_TEST: process.env.HEADLESS_TEST ?? '1',
            MINIMIZE_TEST: process.env.MINIMIZE_TEST ?? '0',
            VOICETREE_PERSIST_STATE: '1',
            VOICETREE_DAEMON_LOAD_TIMEOUT_MS: '180000',
            VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(inputs.repoRoot),
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

    const readyStart = Date.now()
    try {
        await pollExists(rpcPortFilePath(inputs.projectDir), inputs.daemonReadyTimeoutMs, 250)
    } catch (err) {
        writeLog()
        await app.close().catch(() => undefined)
        throw new Error(`${(err as Error).message}. Electron log: ${inputs.logFilePath}`)
    }
    const daemonReadyMs = Date.now() - readyStart

    return { app, bootMs, daemonReadyMs }
}

/**
 * Headful-Electron launch + daemon discovery for the e2e-storm MVP.
 *
 * Boots `dist-electron/main/index.js` with --open-folder so the project
 * picker is bypassed entirely (avoids the xvfb actionability-stable trap
 * documented in the e2e-storm spec). Returns once `<project>/.voicetree/`
 * publishes a usable `rpc.port` + `auth-token` AND the daemon's `/rpc`
 * endpoint answers a `list_agents` probe — i.e. a ready, authenticated
 * `DaemonRpcClient` bound to THIS Electron's daemon.
 *
 * Post-MCP-cutover (commits 2651ade78, fab76e7d4, 15595a854): the in-process
 * MCP server and its `.mcp.json` handshake are gone. Discovery now goes
 * through `@vt/vt-rpc`'s canonical `rpc.port` + `auth-token` chain — the same
 * transport the `vt` CLI uses — rather than re-hand-rolling JSON-RPC.
 *
 * Pure shell — impurity is concentrated here (fs writes, child process,
 * setTimeout polling).
 */
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import * as path from 'node:path'
import * as os from 'node:os'
import { existsSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import {
    createRpcClientForProject,
    type DaemonRpcClient,
} from '@vt/vt-rpc'

export interface ElectronLaunchInputs {
    readonly repoRoot: string
    readonly projectDir: string
    readonly voicetreeHomePath: string
    readonly logFilePath: string
    readonly inspectPort: number
    readonly daemonDiscoveryTimeoutMs: number
    /**
     * Extra env vars merged into electron's launch env. The daemon-client's
     * `resolveCommand` returns `env: { ...process.env }` for the default
     * vt-graphd command spec, so anything we put here propagates from
     * electron-main into the spawned vt-graphd. Used to enable Bob's
     * `perfProbeFromEnv` for the dashboard integration.
     */
    readonly extraEnv?: Readonly<Record<string, string>>
}

export interface ElectronLaunchResult {
    readonly app: ElectronApplication
    readonly daemonClient: DaemonRpcClient
    readonly bootMs: number
    readonly daemonDiscoveryMs: number
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

export function seedUserData(voicetreeHomePath: string, projectDir: string): void {
    const projectName = path.basename(projectDir)
    writeFileSync(
        path.join(voicetreeHomePath, 'projects.json'),
        JSON.stringify([{
            id: 'e2e-storm-mvp-project',
            path: projectDir,
            name: projectName,
            type: 'folder',
            lastOpened: Date.now(),
        }], null, 2),
        'utf8',
    )
    writeFileSync(
        path.join(voicetreeHomePath, 'voicetree-config.json'),
        JSON.stringify({
            lastDirectory: projectDir,
            projectConfig: {
                [projectDir]: { writeFolderPath: projectDir, readPaths: [] },
            },
        }, null, 2),
        'utf8',
    )
}

async function pollFor<T>(
    fn: () => T | null | Promise<T | null>,
    timeoutMs: number,
    intervalMs: number,
): Promise<T> {
    const deadline = Date.now() + timeoutMs
    let lastError: Error | null = null
    while (Date.now() < deadline) {
        try {
            const v = await fn()
            if (v !== null) return v
        } catch (e) {
            lastError = e as Error
        }
        await new Promise(r => setTimeout(r, intervalMs))
    }
    throw new Error(
        `pollFor timed out after ${timeoutMs}ms`
        + (lastError ? `: last error: ${lastError.message}` : ''),
    )
}

/**
 * Discovery env for the harness's own daemon.
 *
 * The harness must talk to the daemon owned by THIS Electron instance, keyed
 * by its temp `projectDir` — never an ambient `$VOICETREE_DAEMON_URL` that a
 * surrounding agent shell might have exported (it would point discovery at a
 * different daemon while the token still comes from `projectDir`, yielding a
 * 401). Stripping the override forces `createRpcClientForProject` to resolve
 * strictly from `<projectDir>/.voicetree/{rpc.port,auth-token}`.
 */
function discoveryEnv(): Record<string, string | undefined> {
    const { VOICETREE_DAEMON_URL: _ignored, ...rest } = process.env
    return rest
}

/**
 * Poll until the project's daemon is discoverable AND serving. `rpc.port` and
 * `auth-token` are published atomically by the daemon, but the file appearing
 * does not by itself prove the socket is accepting or the token authenticates,
 * so we additionally require a successful `list_agents` round-trip. That tool
 * needs no caller terminal, so it is a side-effect-free readiness probe.
 */
async function discoverReadyDaemonClient(
    projectDir: string,
    timeoutMs: number,
): Promise<DaemonRpcClient> {
    const env = discoveryEnv()
    return pollFor(async (): Promise<DaemonRpcClient | null> => {
        let client: DaemonRpcClient
        try {
            client = await createRpcClientForProject(projectDir, { env })
        } catch {
            // rpc.port / auth-token not published yet — keep polling.
            return null
        }
        const probe = await client.call('list_agents', {}).catch(() => null)
        if (probe === null || 'error' in probe) return null
        return client
    }, timeoutMs, 250)
}

export async function launchElectronAndDiscoverDaemon(
    inputs: ElectronLaunchInputs,
): Promise<ElectronLaunchResult> {
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
    const stdout = app.process().stdout
    const stderr = app.process().stderr
    const onChunk = (chunk: Buffer): void => { logChunks.push(chunk.toString('utf8')) }
    stdout?.on('data', onChunk)
    stderr?.on('data', onChunk)

    const writeLog = (): void => {
        try { writeFileSync(inputs.logFilePath, logChunks.join(''), 'utf8') } catch { /* best effort */ }
    }

    const discoveryStart = Date.now()
    let daemonClient: DaemonRpcClient
    try {
        daemonClient = await discoverReadyDaemonClient(inputs.projectDir, inputs.daemonDiscoveryTimeoutMs)
    } catch (err) {
        writeLog()
        await app.close().catch(() => undefined)
        throw new Error(
            `Daemon discovery failed (${(err as Error).message}). `
            + `Electron log saved to ${inputs.logFilePath}.`,
        )
    }
    const daemonDiscoveryMs = Date.now() - discoveryStart

    writeLog()
    // Continue capturing logs after discovery — they get flushed on close.
    stdout?.on('data', () => writeLog())
    stderr?.on('data', () => writeLog())

    return { app, daemonClient, bootMs, daemonDiscoveryMs }
}

/**
 * Headful-Electron launch + `.mcp.json` discovery for the e2e-storm MVP.
 *
 * Boots `dist-electron/main/index.js` with --open-folder so the project
 * picker is bypassed entirely (avoids the xvfb actionability-stable trap
 * documented in the e2e-storm spec). Returns once `<project>/.mcp.json`
 * exists and exposes a usable MCP port.
 *
 * Pure shell — impurity is concentrated here (fs writes, child process,
 * setTimeout polling).
 */
import { _electron as electron } from '@playwright/test'
import type { ElectronApplication } from '@playwright/test'
import * as path from 'node:path'
import * as os from 'node:os'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

export interface ElectronLaunchInputs {
    readonly repoRoot: string
    readonly projectDir: string
    readonly projectDir: string
    readonly voicetreeHomePath: string
    readonly logFilePath: string
    readonly inspectPort: number
    readonly mcpDiscoveryTimeoutMs: number
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
    readonly mcpPort: number
    readonly bootMs: number
    readonly mcpDiscoveryMs: number
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

export function seedUserData(voicetreeHomePath: string, projectDir: string, projectDir: string): void {
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
    fn: () => T | null,
    timeoutMs: number,
    intervalMs: number,
): Promise<T> {
    const deadline = Date.now() + timeoutMs
    let lastError: Error | null = null
    while (Date.now() < deadline) {
        try {
            const v = fn()
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

function readMcpPortFromJson(mcpJsonPath: string): number | null {
    if (!existsSync(mcpJsonPath)) return null
    try {
        const raw = readFileSync(mcpJsonPath, 'utf8')
        const parsed = JSON.parse(raw) as { mcpServers?: Record<string, { url?: string }> }
        const url = parsed.mcpServers?.voicetree?.url
        if (typeof url !== 'string') return null
        const m = url.match(/:(\d+)\/mcp$/)
        if (!m) return null
        return Number.parseInt(m[1], 10)
    } catch {
        // mid-write torn JSON — try again
        return null
    }
}

export async function launchElectronAndDiscoverMcp(
    inputs: ElectronLaunchInputs,
): Promise<ElectronLaunchResult> {
    seedUserData(inputs.voicetreeHomePath, inputs.projectDir, inputs.projectDir)

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

    // .mcp.json is written by vtd at the project root (the dir
    // registered in projects.json), NOT inside the write-folder-path project.
    const mcpJsonPath = path.join(inputs.projectDir, '.mcp.json')
    const discoveryStart = Date.now()
    let mcpPort: number
    try {
        mcpPort = await pollFor(
            () => readMcpPortFromJson(mcpJsonPath),
            inputs.mcpDiscoveryTimeoutMs,
            250,
        )
    } catch (err) {
        writeLog()
        await app.close().catch(() => undefined)
        throw new Error(
            `MCP discovery failed (${(err as Error).message}). `
            + `Electron log saved to ${inputs.logFilePath}.`,
        )
    }
    const mcpDiscoveryMs = Date.now() - discoveryStart

    writeLog()
    // Continue capturing logs after discovery — they get flushed on close.
    stdout?.on('data', () => writeLog())
    stderr?.on('data', () => writeLog())

    return { app, mcpPort, bootMs, mcpDiscoveryMs }
}

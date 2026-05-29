// Pure(-ish) helpers extracted from electron-main-storm.ts to keep the harness
// file under the 500-line cap. Functions here take their inputs explicitly;
// no module-level state. Side-effectful exports surface their effects in their
// signature (process spawn, filesystem polling).

import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
    spawn,
    type ChildProcessWithoutNullStreams,
} from 'node:child_process'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const require = createRequire(import.meta.url)

// measures/perf -> measures -> packages -> repo root
export const REPO_ROOT = resolve(__dirname, '..', '..', '..')

// ─── CLI parsing ─────────────────────────────────────────────────────────

export interface ElectronMainStormArgs {
    readonly agents: number
    readonly nodesPerAgent: number
    readonly projectSeedNodeCount: number
    readonly perAgentTimeoutMs: number
    readonly bootTimeoutMs: number
    readonly settleAfterStormMs: number
    readonly outPath: string | null
    readonly keepArtifacts: boolean
}

export function parseElectronMainStormArgs(argv: readonly string[]): ElectronMainStormArgs {
    const defaults: ElectronMainStormArgs = {
        agents: 5,
        nodesPerAgent: 5,
        projectSeedNodeCount: 200,
        perAgentTimeoutMs: 60_000,
        bootTimeoutMs: 60_000,
        settleAfterStormMs: 2_000,
        outPath: null,
        keepArtifacts: false,
    }
    let agents = defaults.agents
    let nodesPerAgent = defaults.nodesPerAgent
    let projectSeedNodeCount = defaults.projectSeedNodeCount
    let perAgentTimeoutMs = defaults.perAgentTimeoutMs
    let bootTimeoutMs = defaults.bootTimeoutMs
    let settleAfterStormMs = defaults.settleAfterStormMs
    let outPath = defaults.outPath
    let keepArtifacts = defaults.keepArtifacts

    const intArg = (raw: string | undefined, name: string): number => {
        const n = Number.parseInt(raw ?? '', 10)
        if (!Number.isInteger(n) || n < 0) throw new Error(`bad --${name}: ${raw}`)
        return n
    }

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        switch (a) {
            case '--agents': agents = intArg(argv[++i], 'agents'); break
            case '--nodes-per-agent': nodesPerAgent = intArg(argv[++i], 'nodes-per-agent'); break
            case '--project-seed-nodes': projectSeedNodeCount = intArg(argv[++i], 'project-seed-nodes'); break
            case '--per-agent-timeout-ms': perAgentTimeoutMs = intArg(argv[++i], 'per-agent-timeout-ms'); break
            case '--boot-timeout-ms': bootTimeoutMs = intArg(argv[++i], 'boot-timeout-ms'); break
            case '--settle-after-storm-ms': settleAfterStormMs = intArg(argv[++i], 'settle-after-storm-ms'); break
            case '--out': outPath = argv[++i] ?? null; break
            case '--keep-artifacts': keepArtifacts = true; break
            case '--help':
            case '-h':
                process.stdout.write(
                    'electron-main-storm.ts: profile Electron main CPU under an N-agent fake-agent storm.\n'
                    + '  --agents N                    parallel fake-agents (default 5)\n'
                    + '  --nodes-per-agent N           create_node actions per agent (default 5)\n'
                    + '  --project-seed-nodes N          seed-project size (default 200)\n'
                    + '  --per-agent-timeout-ms MS     per-agent completion deadline (default 60000)\n'
                    + '  --boot-timeout-ms MS          how long to wait for app boot + .mcp.json (default 60000)\n'
                    + '  --settle-after-storm-ms MS   keep profiling N ms after last agent exits (default 2000)\n'
                    + '  --out PATH                    .cpuprofile path (default ~/.voicetree/reports/electron-main-storm-<ts>.cpuprofile)\n'
                    + '  --keep-artifacts              keep temp project + userData after the run\n',
                )
                process.exit(0)
            default:
                throw new Error(`unknown argument: ${a}`)
        }
    }
    return {
        agents, nodesPerAgent, projectSeedNodeCount, perAgentTimeoutMs,
        bootTimeoutMs, settleAfterStormMs, outPath, keepArtifacts,
    }
}

// ─── Repo + binary resolution ────────────────────────────────────────────

export function resolveElectronBinary(): string {
    const electronModuleEntry = require.resolve('electron', {
        paths: [join(REPO_ROOT, 'webapp'), REPO_ROOT],
    })
    const binary = require(electronModuleEntry) as unknown
    if (typeof binary !== 'string') {
        throw new Error(`require('electron') did not return a string path (got ${typeof binary})`)
    }
    if (!existsSync(binary)) {
        throw new Error(
            `electron binary missing at ${binary}\n`
            + `The electron npm package was installed but its postinstall didn't download the\n`
            + `platform binary. Run \`npm rebuild electron\` (or reinstall) on this machine.`,
        )
    }
    return binary
}

export function resolveMainBundleEntry(): string {
    const entry = join(REPO_ROOT, 'webapp', 'dist-electron', 'main', 'index.js')
    if (!existsSync(entry)) {
        throw new Error(
            `Built electron main bundle missing at ${entry}.\n`
            + `Run \`npm --workspace webapp exec -- electron-vite build\` first.`,
        )
    }
    return entry
}

// ─── Electron lifecycle ──────────────────────────────────────────────────

export async function spawnElectron(args: {
    electronBinary: string
    mainEntry: string
    userDataDir: string
    openFolder: string
    bootTimeoutMs: number
}): Promise<{ proc: ChildProcessWithoutNullStreams; inspectPort: number }> {
    const linuxFlags = process.platform === 'linux'
        ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        : []
    const proc = spawn(
        args.electronBinary,
        [
            '--inspect=0',
            ...linuxFlags,
            args.mainEntry,
            `--user-data-dir=${args.userDataDir}`,
            '--open-folder', args.openFolder,
        ],
        {
            env: {
                ...process.env,
                NODE_ENV: 'test',
                VOICETREE_PERSIST_STATE: '1',
            },
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    ) as ChildProcessWithoutNullStreams

    const inspectPort = await new Promise<number>((resolveP, rejectP) => {
        const timeout = setTimeout(
            () => rejectP(new Error(`timed out waiting for --inspect port after ${args.bootTimeoutMs}ms`)),
            args.bootTimeoutMs,
        )
        let stderrBuf = ''
        proc.stderr.on('data', (chunk: Buffer) => {
            const text = chunk.toString()
            stderrBuf += text
            process.stderr.write(`[electron] ${text}`)
            const match = stderrBuf.match(/Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
            if (match) {
                clearTimeout(timeout)
                resolveP(Number.parseInt(match[1], 10))
            }
        })
        proc.on('error', (err) => { clearTimeout(timeout); rejectP(err) })
        proc.on('exit', (code, signal) => {
            clearTimeout(timeout)
            rejectP(new Error(`electron exited before inspect port appeared (code=${code} signal=${signal})`))
        })
    })

    proc.stdout.on('data', (chunk: Buffer) => {
        process.stderr.write(`[electron] ${chunk.toString()}`)
    })
    return { proc, inspectPort }
}

/**
 * Poll `<project>/.mcp.json` for the voicetree MCP port. This file was written
 * by the electron app's in-process MCP server before the MCP→CLI cutover.
 *
 * WARNING (pre-existing damage, out of scope for this PR): the in-process MCP
 * server has been removed (commits 2651ade78, fab76e7d4, 15595a854) and the
 * unified HTTP daemon writes `.voicetree/daemon-url` + `.voicetree/auth-token`
 * — *not* `.mcp.json`. This harness's boot path therefore times out against a
 * post-cutover app. Migrating it requires rewriting the discovery handshake;
 * tracked as a follow-up.
 */
export async function waitForMcpPort(project: string, timeoutMs: number): Promise<number> {
    const mcpPath = join(project, '.mcp.json')
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (existsSync(mcpPath)) {
            try {
                const raw = readFileSync(mcpPath, 'utf8')
                const cfg = JSON.parse(raw) as {
                    mcpServers?: Record<string, { url?: string }>
                }
                const url = cfg.mcpServers?.voicetree?.url
                if (url) {
                    const m = url.match(/:(\d+)\/mcp$/)
                    if (m) return Number.parseInt(m[1], 10)
                }
            } catch {
                // file may be mid-write; retry
            }
        }
        await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error(`timed out waiting for ${mcpPath} after ${timeoutMs}ms`)
}

export async function stopElectron(proc: ChildProcessWithoutNullStreams): Promise<void> {
    if (proc.exitCode !== null || proc.signalCode !== null) return
    proc.kill('SIGTERM')
    await new Promise<void>((resolveP) => {
        const force = setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* */ } }, 5000)
        proc.on('exit', () => { clearTimeout(force); resolveP() })
    })
}

// ─── Agent exit accounting ───────────────────────────────────────────────

export interface AgentResult {
    readonly terminalId: string
    readonly spawnSuccess: boolean
    readonly exitCode: number | null
    readonly exitedAtMs: number | null
    readonly errorMessage?: string
}

export async function waitForExitOrTimeout(
    isExited: () => { code: number; atMs: number } | undefined,
    isRecordExited: () => boolean,
    timeoutMs: number,
): Promise<{ code: number; atMs: number } | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const found = isExited()
        if (found) return found
        if (isRecordExited()) return { code: 0, atMs: Date.now() }
        await new Promise((r) => setTimeout(r, 200))
    }
    return null
}

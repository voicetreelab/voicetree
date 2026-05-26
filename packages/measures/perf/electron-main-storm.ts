/**
 * Perf harness: electron-main-storm.
 *
 * Spawns the prebuilt VoiceTree Electron app with `--inspect=0`, lets it boot
 * its own graph-db daemon + MCP server against a freshly seeded temp vault,
 * then storms it with N tmux-backed `vt-fake-agent` subprocesses pointed at
 * the app-owned MCP port — all while capturing a sampling CPU profile of the
 * Electron *main* process via the V8 Inspector (CDP `Profiler` domain).
 *
 * Output:
 *   - `.cpuprofile` written under `~/.voicetree/reports/` (openable in Chrome
 *     DevTools Performance tab, VS Code, or speedscope.app)
 *   - Inline top-50 self-time table printed to stdout, app code marked `>>>`
 *
 * Why it exists:
 *   The daemon-only `agent-storm.ts` harness runs no Electron, so any cost
 *   the regression hides in `electron-main` (IPC fanout, SSE relay, native
 *   addons, the daemon-recovery code path itself) is invisible to it. This
 *   harness drives the real packaged main bundle end-to-end and produces a
 *   flame-graph-quality artifact pinned to the agent-spawn window.
 *
 * Scope honesty:
 *   - Only the main process is profiled. Renderer is out of scope (would need
 *     CDP Tracing + a renderer page handle — Playwright territory).
 *   - The fake-agent script is the same `create_node` × N flow agent-storm.ts
 *     uses; only the *fake-agent* is mocked, the daemon + MCP + watch-folder
 *     are real.
 *
 * Run:
 *   npm run perf:main-storm:local -- --agents 5 --nodes-per-agent 5
 *   npm run perf:main-storm       -- --agents 5 --nodes-per-agent 5  (via Onidel)
 */

import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { agentRuntime, configureAgentRuntime } from '@vt/agent-runtime'
import {
    createTerminalData,
    type TerminalData,
    type TerminalId,
} from '@vt/agent-runtime/types'
import { initGraphModel } from '@vt/graph-model'
import { generateVaultOnDisk } from '@vt/perf-fixtures'

import {
    analyzeMainProcessProfile,
    printMainProcessMetrics,
    startMainProcessProfile,
    startRendererProcessProfile,
    stopMainProcessProfileAndSave,
    stopRendererProcessProfileAndSave,
    type MainProcessCdpHandle,
} from './_shared/main-process-cdp.ts'

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

interface Args {
    readonly agents: number
    readonly nodesPerAgent: number
    readonly vaultSeedNodeCount: number
    readonly perAgentTimeoutMs: number
    readonly bootTimeoutMs: number
    readonly settleAfterStormMs: number
    readonly outPath: string | null
    readonly keepArtifacts: boolean
}

function parseArgs(argv: readonly string[]): Args {
    const defaults: Args = {
        agents: 5,
        nodesPerAgent: 5,
        vaultSeedNodeCount: 200,
        perAgentTimeoutMs: 60_000,
        bootTimeoutMs: 60_000,
        settleAfterStormMs: 2_000,
        outPath: null,
        keepArtifacts: false,
    }
    let agents = defaults.agents
    let nodesPerAgent = defaults.nodesPerAgent
    let vaultSeedNodeCount = defaults.vaultSeedNodeCount
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
            case '--vault-seed-nodes': vaultSeedNodeCount = intArg(argv[++i], 'vault-seed-nodes'); break
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
                    + '  --vault-seed-nodes N          seed-vault size (default 200)\n'
                    + '  --per-agent-timeout-ms MS     per-agent completion deadline (default 60000)\n'
                    + '  --boot-timeout-ms MS          how long to wait for app boot + .mcp.json (default 60000)\n'
                    + '  --settle-after-storm-ms MS   keep profiling N ms after last agent exits (default 2000)\n'
                    + '  --out PATH                    .cpuprofile path (default ~/.voicetree/reports/electron-main-storm-<ts>.cpuprofile)\n'
                    + '  --keep-artifacts              keep temp vault + userData after the run\n',
                )
                process.exit(0)
                break
            default:
                throw new Error(`unknown argument: ${a}`)
        }
    }
    return {
        agents, nodesPerAgent, vaultSeedNodeCount, perAgentTimeoutMs,
        bootTimeoutMs, settleAfterStormMs, outPath, keepArtifacts,
    }
}

// ---------------------------------------------------------------------------
// Repo + binary resolution
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const require = createRequire(import.meta.url)

// measures/perf -> measures -> packages -> repo root
const REPO_ROOT = resolve(__dirname, '..', '..', '..')

function resolveElectronBinary(): string {
    // `require('electron')` returns the absolute path to the platform binary
    // (e.g. .../node_modules/electron/dist/electron on Linux,
    //       .../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron on macOS).
    // Resolve from webapp/ so we get the workspace-local copy electron-vite uses.
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

function resolveMainBundleEntry(): string {
    const entry = join(REPO_ROOT, 'webapp', 'dist-electron', 'main', 'index.js')
    if (!existsSync(entry)) {
        throw new Error(
            `Built electron main bundle missing at ${entry}.\n`
            + `Run \`npm --workspace webapp exec -- electron-vite build\` first.`,
        )
    }
    return entry
}

function resolveFakeAgentEntrypoint(): { dir: string; entry: string } {
    const dir = join(REPO_ROOT, 'tools', 'vt-fake-agent')
    const entry = join(dir, 'src', 'index.ts')
    if (!existsSync(entry)) throw new Error(`vt-fake-agent entrypoint not found at ${entry}`)
    return { dir, entry }
}

function resolveTsxImportPath(): string {
    return require.resolve('tsx')
}

function rendererProfileFilename(mainProfileFilename: string): string {
    return mainProfileFilename.endsWith('.cpuprofile')
        ? mainProfileFilename.replace(/\.cpuprofile$/, '.renderer.cpuprofile')
        : `${mainProfileFilename}.renderer.cpuprofile`
}

async function uploadRendererProfileToPyroscope(args: {
    cpuprofilePath: string
    runUuid: string
}): Promise<string> {
    const uploader = join(REPO_ROOT, 'scripts', 'renderer-profile-to-pyroscope.mjs')
    return await new Promise((resolveUpload, reject) => {
        const child = spawn(process.execPath, [uploader, args.cpuprofilePath, args.runUuid], {
            cwd: REPO_ROOT,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        let stdout = ''
        let stderr = ''
        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
        child.on('error', reject)
        child.on('exit', (code, signal) => {
            if (code === 0) resolveUpload(stdout.trim())
            else reject(new Error(
                `renderer Pyroscope upload failed code=${code ?? 'null'} signal=${signal ?? 'none'}`
                + (stderr.trim() ? ` stderr=${stderr.trim()}` : ''),
            ))
        })
    })
}

// ---------------------------------------------------------------------------
// Electron lifecycle
// ---------------------------------------------------------------------------

/**
 * Spawn the prebuilt electron app with `--inspect=0` and capture the inspect
 * port from stderr. Returns once Node has emitted the `Debugger listening` line.
 */
async function spawnElectron(args: {
    electronBinary: string
    mainEntry: string
    userDataDir: string
    openFolder: string
    bootTimeoutMs: number
}): Promise<{ proc: ChildProcessWithoutNullStreams; inspectPort: number; rendererRemoteDebugPort: number }> {
    // Linux dev boxes (Onidel) run as root and have no X server; mirror the
    // flag set used by webapp's e2e specs (no-sandbox + swiftshader + dev-shm).
    // On macOS none of these are needed.
    const linuxFlags = process.platform === 'linux'
        ? ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
        : []
    const proc = spawn(
        args.electronBinary,
        [
            '--inspect=0',
            '--remote-debugging-port=0',
            ...linuxFlags,
            args.mainEntry,
            `--user-data-dir=${args.userDataDir}`,
            // --open-folder bypasses the project-picker UI and tells main to
            // open this vault directly on launch (see environment-config.ts).
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

    const ports = await new Promise<{ inspectPort: number; rendererRemoteDebugPort: number }>((resolveP, rejectP) => {
        const timeout = setTimeout(
            () => rejectP(new Error(`timed out waiting for inspector ports after ${args.bootTimeoutMs}ms`)),
            args.bootTimeoutMs,
        )
        let stderrBuf = ''
        let inspectPort: number | undefined
        let rendererRemoteDebugPort: number | undefined
        const maybeResolve = () => {
            if (inspectPort === undefined || rendererRemoteDebugPort === undefined) return
            clearTimeout(timeout)
            resolveP({ inspectPort, rendererRemoteDebugPort })
        }
        proc.stderr.on('data', (chunk: Buffer) => {
            const text = chunk.toString()
            stderrBuf += text
            // Echo electron stderr to our stderr so boot errors are visible.
            process.stderr.write(`[electron] ${text}`)
            const inspectMatch = stderrBuf.match(/Debugger listening on ws:\/\/127\.0\.0\.1:(\d+)\//)
            const rendererMatch = stderrBuf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\/devtools\/browser\//)
            if (inspectMatch) inspectPort = Number.parseInt(inspectMatch[1], 10)
            if (rendererMatch) rendererRemoteDebugPort = Number.parseInt(rendererMatch[1], 10)
            maybeResolve()
        })
        proc.on('error', (err) => { clearTimeout(timeout); rejectP(err) })
        proc.on('exit', (code, signal) => {
            clearTimeout(timeout)
            rejectP(new Error(`electron exited before inspect port appeared (code=${code} signal=${signal})`))
        })
    })

    // Continue echoing electron stdout for visibility, but stop accumulating.
    proc.stdout.on('data', (chunk: Buffer) => {
        process.stderr.write(`[electron] ${chunk.toString()}`)
    })
    return { proc, ...ports }
}

/**
 * Poll `<vault>/.mcp.json` for the voicetree MCP port. This file is written by
 * the electron app once its in-process MCP server has bound a port.
 */
async function waitForMcpPort(vault: string, timeoutMs: number): Promise<number> {
    const mcpPath = join(vault, '.mcp.json')
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

async function stopElectron(proc: ChildProcessWithoutNullStreams): Promise<void> {
    if (proc.exitCode !== null || proc.signalCode !== null) return
    proc.kill('SIGTERM')
    await new Promise<void>((resolveP) => {
        const force = setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* */ } }, 5000)
        proc.on('exit', () => { clearTimeout(force); resolveP() })
    })
}

// ---------------------------------------------------------------------------
// Fake-agent storm
// ---------------------------------------------------------------------------

function buildFakeAgentScript(nodesPerAgent: number): object {
    const actions: object[] = []
    for (let i = 0; i < nodesPerAgent; i++) {
        actions.push({
            type: 'create_node',
            title: `Perf Node ${i}`,
            summary: `Synthetic node ${i} from electron-main-storm.`,
            content: `Node body ${i}.`,
        })
    }
    actions.push({ type: 'exit', code: 0 })
    return { actions }
}

interface AgentResult {
    readonly terminalId: string
    readonly spawnSuccess: boolean
    readonly exitCode: number | null
    readonly exitedAtMs: number | null
    readonly errorMessage?: string
}

async function waitForExit(
    terminalId: string,
    exitedTerminals: Map<string, { code: number; atMs: number }>,
    timeoutMs: number,
): Promise<{ code: number; atMs: number } | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const found = exitedTerminals.get(terminalId)
        if (found) return found
        const record = agentRuntime.getTerminalRecords().find((r) => r.terminalId === terminalId)
        if (record?.status === 'exited') {
            const entry = { code: 0, atMs: Date.now() }
            exitedTerminals.set(terminalId, entry)
            return entry
        }
        await new Promise((r) => setTimeout(r, 200))
    }
    return null
}

async function runStorm(args: {
    mcpPort: number
    vault: string
    appSupport: string
    agents: number
    nodesPerAgent: number
    perAgentTimeoutMs: number
}): Promise<readonly AgentResult[]> {
    const { dir: fakeAgentDir, entry: fakeAgentEntrypoint } = resolveFakeAgentEntrypoint()
    const tsxImportPath = resolveTsxImportPath()

    // graph-model is initialised by `startDaemon` in the daemon-only harness;
    // here Electron owns the daemon, so init it locally for the in-process
    // agentRuntime (`loadSettings` → `getSettingsPath` → `getConfig`).
    initGraphModel({ appSupportPath: args.appSupport })

    configureAgentRuntime({
        env: {
            getAppSupportPath: (): string => args.appSupport,
            getMcpPort: (): number => args.mcpPort,
        },
    })

    await agentRuntime.ensureTmuxAvailable()
    await agentRuntime.ensureTmuxServer()

    const script = buildFakeAgentScript(args.nodesPerAgent)
    const agentPrompt = `### FAKE_AGENT_SCRIPT ###\n${JSON.stringify(script)}\n### END_FAKE_AGENT_SCRIPT ###`

    const exitedTerminals = new Map<string, { code: number; atMs: number }>()
    const onData = (_id: string, _data: string): void => { /* drop; profile is the artifact */ }
    const onExit = (id: string, exitCode: number): void => {
        if (!exitedTerminals.has(id)) exitedTerminals.set(id, { code: exitCode, atMs: Date.now() })
    }

    const launches: Promise<AgentResult>[] = []
    for (let i = 0; i < args.agents; i++) {
        const terminalId = `perf-agent-${i}` as TerminalId
        const initialEnvVars: Record<string, string> = {
            VOICETREE_TERMINAL_ID: terminalId,
            VOICETREE_MCP_PORT: String(args.mcpPort),
            VOICETREE_VAULT_PATH: args.vault,
            TASK_NODE_PATH: `${args.vault}/${terminalId}-task.md`,
            AGENT_PROMPT: agentPrompt,
        }
        const td: TerminalData = createTerminalData({
            terminalId,
            attachedToNodeId: args.vault,
            terminalCount: i,
            title: terminalId,
            agentName: terminalId,
            isHeadless: true,
            initialEnvVars,
            initialCommand: `${JSON.stringify(process.execPath)} --import ${JSON.stringify(tsxImportPath)} ${JSON.stringify(fakeAgentEntrypoint)}; exit`,
            executeCommand: true,
            initialSpawnDirectory: fakeAgentDir,
        })

        launches.push((async (): Promise<AgentResult> => {
            const spawnRes = await agentRuntime.getTerminalManager().spawnTmuxBacked({
                terminalData: td,
                getToolsDirectory: () => fakeAgentDir,
                onData,
                onExit,
            })
            if (!spawnRes.success) {
                return {
                    terminalId,
                    spawnSuccess: false,
                    exitCode: -1,
                    exitedAtMs: Date.now(),
                    errorMessage: spawnRes.error ?? 'spawn failed',
                }
            }
            const exit = await waitForExit(terminalId, exitedTerminals, args.perAgentTimeoutMs)
            return {
                terminalId,
                spawnSuccess: true,
                exitCode: exit?.code ?? null,
                exitedAtMs: exit?.atMs ?? null,
            }
        })())
    }

    return Promise.all(launches)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2))

    const electronBinary = resolveElectronBinary()
    const mainEntry = resolveMainBundleEntry()

    const tempVault = mkdtempSync(join(tmpdir(), 'vt-mainstorm-vault-'))
    const tempUserData = mkdtempSync(join(tmpdir(), 'vt-mainstorm-userdata-'))
    const tempAppSupport = mkdtempSync(join(tmpdir(), 'vt-mainstorm-appsupport-'))

    const vaultLayout = generateVaultOnDisk(tempVault, args.vaultSeedNodeCount)
    process.stdout.write(`[main-storm] seeded vault: ${vaultLayout.nodes.length} nodes at ${tempVault}\n`)

    let electronProc: ChildProcessWithoutNullStreams | null = null
    let cdpHandle: MainProcessCdpHandle | null = null
    let rendererCdpHandle: MainProcessCdpHandle | null = null

    try {
        const spawned = await spawnElectron({
            electronBinary,
            mainEntry,
            userDataDir: tempUserData,
            openFolder: tempVault,
            bootTimeoutMs: args.bootTimeoutMs,
        })
        electronProc = spawned.proc
        const inspectPort = spawned.inspectPort
        const rendererRemoteDebugPort = spawned.rendererRemoteDebugPort
        process.stdout.write(`[main-storm] electron pid=${electronProc.pid} inspect=${inspectPort}\n`)
        process.stdout.write(`[main-storm] renderer remote debugging=${rendererRemoteDebugPort}\n`)

        const mcpPort = await waitForMcpPort(tempVault, args.bootTimeoutMs)
        process.stdout.write(`[main-storm] discovered MCP port=${mcpPort}\n`)

        // Start the CPU profiler *before* the storm so all spawn-time cost is
        // captured. The first inspector connection can race with the daemon's
        // own setup spans, but we accept that — they're outside our hot path.
        cdpHandle = await startMainProcessProfile(inspectPort)
        rendererCdpHandle = await startRendererProcessProfile(rendererRemoteDebugPort, args.bootTimeoutMs)
        const profileStartedAt = Date.now()
        process.stdout.write(`[main-storm] CPU profiles started\n`)

        const stormStart = Date.now()
        const results = await runStorm({
            mcpPort,
            vault: tempVault,
            appSupport: tempAppSupport,
            agents: args.agents,
            nodesPerAgent: args.nodesPerAgent,
            perAgentTimeoutMs: args.perAgentTimeoutMs,
        })
        const stormWallMs = Date.now() - stormStart
        const completed = results.filter((r) => r.exitCode === 0).length
        const failed = results.filter((r) => r.exitCode !== null && r.exitCode !== 0).length
        const timedOut = results.filter((r) => r.exitedAtMs === null).length

        // Brief settle window so any post-storm bursts (final SSE drain, file
        // watcher flush) are visible in the profile.
        if (args.settleAfterStormMs > 0) {
            await new Promise((r) => setTimeout(r, args.settleAfterStormMs))
        }

        const timestamp = Date.now()
        const outPath = args.outPath ?? join(
            homedir(), '.voicetree', 'reports',
            `electron-main-storm-${timestamp}.cpuprofile`,
        )
        const outDir = dirname(outPath)
        const outName = outPath.slice(outDir.length + 1)
        mkdirSync(outDir, { recursive: true })

        const cpuprofilePath = await stopMainProcessProfileAndSave(cdpHandle, outDir, outName)
        cdpHandle = null
        const rendererCpuprofilePath = await stopRendererProcessProfileAndSave(
            rendererCdpHandle,
            outDir,
            rendererProfileFilename(outName),
        )
        rendererCdpHandle = null
        const profileWallMs = Date.now() - profileStartedAt
        process.stdout.write(`[main-storm] CPU profile saved (${profileWallMs}ms window): ${cpuprofilePath}\n`)
        process.stdout.write(`[main-storm] renderer CPU profile saved: ${rendererCpuprofilePath}\n`)

        const runUuid = process.env.VOICETREE_RUN_INSTANCE_ID
        if (runUuid && runUuid.length > 0) {
            const uploadResult = await uploadRendererProfileToPyroscope({
                cpuprofilePath: rendererCpuprofilePath,
                runUuid,
            })
            process.stdout.write(`[main-storm] renderer Pyroscope upload:\n${uploadResult}\n`)
        } else {
            process.stderr.write('[main-storm] VOICETREE_RUN_INSTANCE_ID unset; renderer Pyroscope upload skipped\n')
        }

        const profileJson = readFileSync(cpuprofilePath, 'utf8')
        const metrics = analyzeMainProcessProfile(profileJson)
        printMainProcessMetrics(metrics)

        process.stdout.write('\n=== electron-main-storm summary ===\n')
        process.stdout.write(`agents:        ${args.agents} requested, ${completed} ok, ${failed} failed, ${timedOut} timed out\n`)
        process.stdout.write(`nodes/agent:   ${args.nodesPerAgent}\n`)
        process.stdout.write(`storm wall:    ${stormWallMs}ms\n`)
        process.stdout.write(`profile wall:  ${profileWallMs}ms\n`)
        process.stdout.write(`cpuprofile:    ${cpuprofilePath}\n`)
        process.stdout.write(`renderer:      ${rendererCpuprofilePath}\n`)
        process.stdout.write(`view:          drag into Chrome DevTools Performance tab, or speedscope.app\n`)

        const exitCode = failed > 0 || timedOut > 0 ? 1 : 0
        // Teardown happens in finally{}.
        process.exitCode = exitCode
    } finally {
        // Stop profiler first if still active (e.g. error mid-storm) so we
        // don't leak the websocket.
        if (cdpHandle) {
            try { cdpHandle.close() } catch { /* */ }
        }
        if (rendererCdpHandle) {
            try { rendererCdpHandle.close() } catch { /* */ }
        }
        try { agentRuntime.getTerminalManager().cleanup() } catch { /* */ }
        if (electronProc) await stopElectron(electronProc)
        if (!args.keepArtifacts) {
            rmSync(tempVault, { recursive: true, force: true })
            rmSync(tempUserData, { recursive: true, force: true })
            rmSync(tempAppSupport, { recursive: true, force: true })
        } else {
            process.stdout.write(`[main-storm] artifacts kept: vault=${tempVault} userData=${tempUserData} appSupport=${tempAppSupport}\n`)
        }
    }
}

void main().catch((err: unknown) => {
    process.stderr.write(`[main-storm] fatal: ${(err as Error).message}\n`)
    if (err instanceof Error && err.stack) process.stderr.write(err.stack + '\n')
    process.exit(1)
})

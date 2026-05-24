/**
 * E2E PERF TEST: real Electron app + real daemon + real agent storm.
 *
 * The diagonal cell that `agent-storm.ts` and the existing CDP perf specs do
 * NOT cover: a real Electron VoiceTree main bundle driven under an external
 * fake-agent storm. Daemon, electron-main, renderer, cytoscape, chokidar,
 * SQLite, and disk all run real; only the fake-agents are "mocked".
 *
 * Pipeline:
 *   1. Seed a temp `userData` + a fresh realistic vault via @vt/perf-fixtures.
 *   2. Launch `dist-electron/main/index.js` with --inspect=<port> and the
 *      seeded project. The app boots its own graph-db-server and writes
 *      <vault>/.mcp.json as it would for a real user.
 *   3. Read the MCP port from <vault>/.mcp.json (prod-shape discovery — no
 *      test-only IPC).
 *   4. Snapshot byte offsets of the three OTel NDJSON trace files
 *      (vt-graphd, vt-electron-daemon, vt-renderer).
 *   5. Start CDP main + renderer CPU profilers; record `Performance.getMetrics`
 *      before storm.
 *   6. Configure agent-runtime in this Playwright process (env-only, no
 *      daemon/MCP boot) and spawn N tmux-backed vt-fake-agents pointing at
 *      the discovered MCP port. Same env contract as `agent-storm.ts`.
 *   7. Await each agent's exit; record `Performance.getMetrics` after storm.
 *   8. Read NDJSON tails; aggregate spans; save .cpuprofile files; emit a
 *      JSON report at ~/.voicetree/reports/perf-agent-storm-e2e-<ts>.json
 *      with `args.variant: "e2e"` and the same top-level shape as the
 *      daemon-only harness's report (plus new `cdp.*` and `spans.vtRenderer`
 *      sections).
 *
 * Report shape (consumed by future dashboards; currently no consumer):
 *   args:                          parsed CLI flags + variant: "e2e"
 *   wallMs:                        storm wall time in ms
 *   agentCount/completedCount/...: same as daemon-only harness
 *   filesCreated:                  count of .md files in vault after storm
 *   vaultPath / appSupportPath:    absolute paths (kept if --keep-artifacts)
 *   spans.vtGraphd:                summary of vt-graphd.ndjson tail
 *   spans.vtElectronDaemon:        summary of vt-electron-daemon.ndjson tail
 *   spans.vtRenderer:              summary of vt-renderer.ndjson tail (zero
 *                                  counters when the file does not exist —
 *                                  the renderer tracer is a follow-up; see
 *                                  RENDERER SPAN SPEC below)
 *   cdp.mainMetrics:               Performance.getMetrics snapshots
 *                                  { before, after } for the electron main
 *                                  process inspector port
 *   cdp.rendererMetrics:           same for the renderer page CDP session
 *   cdp.profiles:                  absolute paths to main + renderer
 *                                  .cpuprofile files captured during the
 *                                  storm window
 *   agents[]:                      per-agent result objects
 *
 * RENDERER SPAN SPEC (deferred — the OpenSpec calls out renderer spans as a
 * follow-up change; this spec tolerates an absent vt-renderer.ndjson):
 *
 *   - `renderer.sse.event-received` — at
 *     webapp/src/shell/edge/UI-edge/text_to_tree_server_communication/sse-consumer.ts
 *     inside each `SSE_EVENT_TYPES` listener body. Attributes: `eventType`,
 *     `bytes`, `enqueuedAt`. Parent: extracted from `traceparent` if the
 *     daemon attaches it to SSE frame data (currently UNVERIFIED — the
 *     daemon's existing W3C propagator only injects on HTTP responses).
 *   - `renderer.delta.project` — wherever `projectDelta(delta)` is called in
 *     the renderer pipeline producing the `ProjectedGraph` for ui-apply.
 *     Attributes: `inputNodeCount`, `inputEdgeCount`, `outputNodeCount`,
 *     `outputEdgeCount`.
 *   - `renderer.delta.apply-ui` — wraps the body of `applyGraphDeltaToUI` in
 *     webapp/src/shell/edge/UI-edge/graph/actions/applyGraphDeltaToUI.ts.
 *     Attributes: `addedNodes`, `removedNodes`, `updatedNodes`, `addedEdges`.
 *   - `renderer.layout.invalidate` — wraps the call into
 *     `syncLargeGraphPerformanceMode` / cola layout invalidation triggered
 *     by a delta apply. Attributes: `dirtyNodeCount`, `mode` ('fullPack' |
 *     'localCola' | 'noop').
 *   - `renderer.react.render` — bracket around the next React commit after
 *     a delta apply. Attributes: `committedFiberCount` if cheaply available,
 *     else just timing.
 *
 *   Renderer tracer implementation (NOT in this change): a renderer-side
 *   OTel tracer using `@opentelemetry/sdk-trace-web` with an IPC-batched
 *   exporter that forwards spans to electron-main, which appends them to
 *   `~/.voicetree/traces/vt-renderer.ndjson` in the same NDJSON shape used
 *   by graph-db-server's existing tracer. The renderer tracer provider must
 *   register the same `CompositePropagator(W3CTraceContextPropagator,
 *   W3CBaggagePropagator)` so cross-process correlation continues to work.
 *
 * Routing: invoked as `npm run test:perf:e2e-storm` (Onidel via run-remote.mjs)
 *   or `:local` for direct invocation. Linux hosts must have xvfb-run installed
 *   and the canonical xvfb wrapper in `packages/measures/src/_runners/
 *   run-with-xvfb-if-needed.ts` handles DISPLAY-less environments.
 */

import { test as base, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    statSync,
    writeFileSync,
} from 'node:fs'
import * as os from 'node:os'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import { generateVaultOnDisk, type VaultLayout } from '@vt/perf-fixtures'
import { killOrphanVtGraphdDaemons } from '@vt/graph-db-client'
import { agentRuntime, configureAgentRuntime } from '@vt/agent-runtime'
import {
    createTerminalData,
    type TerminalData,
    type TerminalId,
} from '@vt/agent-runtime/types'

import {
    startMainProcessProfile,
    stopMainProcessProfileAndSave,
    analyzeMainProcessProfile,
    printMainProcessMetrics,
} from './perf-helpers/mainProcessProfile'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

// ─── Args ────────────────────────────────────────────────────────────────

interface E2EArgs {
    readonly agents: number
    readonly nodesPerAgent: number
    readonly vaultSeedNodeCount: number
    readonly perAgentTimeoutMs: number
    readonly globalTimeoutMs: number
    readonly keepArtifacts: boolean
}

function intEnv(key: string, fallback: number): number {
    const raw = process.env[key]
    if (raw === undefined || raw === '') return fallback
    const n = Number.parseInt(raw, 10)
    if (!Number.isInteger(n) || n < 0) throw new Error(`bad env ${key}=${raw}`)
    return n
}

function boolEnv(key: string): boolean {
    const raw = process.env[key]
    return raw === '1' || raw === 'true'
}

function parseArgs(): E2EArgs {
    return {
        agents: intEnv('PERF_E2E_AGENTS', 8),
        nodesPerAgent: intEnv('PERF_E2E_NODES_PER_AGENT', 30),
        vaultSeedNodeCount: intEnv('PERF_E2E_VAULT_SEED_NODES', 300),
        perAgentTimeoutMs: intEnv('PERF_E2E_PER_AGENT_TIMEOUT_MS', 120_000),
        globalTimeoutMs: intEnv('PERF_E2E_GLOBAL_TIMEOUT_MS', 10 * 60_000),
        keepArtifacts: boolEnv('PERF_E2E_KEEP_ARTIFACTS'),
    }
}

// ─── Span / report helpers (mirrored from agent-storm.ts so the e2e and
// daemon-only reports stay shape-compatible) ──────────────────────────────

interface SpanRecord {
    readonly traceId: string
    readonly spanId: string
    readonly name: string
    readonly durationMs: number
    readonly attributes?: Record<string, unknown>
}

interface SpanSummary {
    readonly totalNew: number
    readonly byName: Record<string, number>
    readonly byOutcome: Record<string, number>
    readonly durationsMs: Record<string, { p50: number; p95: number; p99: number; max: number }>
}

function ndjsonFileSize(filePath: string): number {
    try { return statSync(filePath).size } catch { return 0 }
}

function readNdjsonTail(filePath: string, fromByteOffset: number): SpanRecord[] {
    if (!existsSync(filePath)) return []
    const buf = readFileSync(filePath)
    if (buf.length <= fromByteOffset) return []
    const tail = buf.subarray(fromByteOffset).toString('utf8')
    const out: SpanRecord[] = []
    for (const line of tail.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length === 0) continue
        try {
            out.push(JSON.parse(trimmed) as SpanRecord)
        } catch {
            // skip mid-write torn lines
        }
    }
    return out
}

function quantile(sorted: readonly number[], q: number): number {
    if (sorted.length === 0) return 0
    if (sorted.length === 1) return sorted[0]
    const pos = (sorted.length - 1) * q
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    if (lo === hi) return sorted[lo]
    return sorted[lo] * (1 - (pos - lo)) + sorted[hi] * (pos - lo)
}

function summarizeSpans(spans: readonly SpanRecord[]): SpanSummary {
    const byName: Record<string, number> = {}
    const byOutcome: Record<string, number> = {}
    const durationsByName: Record<string, number[]> = {}
    for (const span of spans) {
        byName[span.name] = (byName[span.name] ?? 0) + 1
        const outcome = span.attributes?.outcome
        if (typeof outcome === 'string') {
            const key = `${span.name}/${outcome}`
            byOutcome[key] = (byOutcome[key] ?? 0) + 1
        }
        const list = durationsByName[span.name] ?? (durationsByName[span.name] = [])
        list.push(span.durationMs)
    }
    const durationsMs: SpanSummary['durationsMs'] = {}
    for (const [name, raw] of Object.entries(durationsByName)) {
        const sorted = [...raw].sort((a, b) => a - b)
        durationsMs[name] = {
            p50: quantile(sorted, 0.5),
            p95: quantile(sorted, 0.95),
            p99: quantile(sorted, 0.99),
            max: sorted[sorted.length - 1],
        }
    }
    return { totalNew: spans.length, byName, byOutcome, durationsMs }
}

function countMarkdownFiles(dir: string): number {
    let count = 0
    const walk = (d: string): void => {
        let entries: readonly string[]
        try { entries = readdirSync(d) } catch { return }
        for (const entry of entries) {
            if (entry.startsWith('.')) continue
            const full = path.join(d, entry)
            let stat
            try { stat = statSync(full) } catch { continue }
            if (stat.isDirectory()) walk(full)
            else if (stat.isFile() && entry.endsWith('.md')) count++
        }
    }
    walk(dir)
    return count
}

// ─── Fake-agent spawn helpers (re-implementing the daemon-harness contract,
// adjusted for the Playwright-process caller) ─────────────────────────────

function buildFakeAgentScript(nodesPerAgent: number): object {
    const actions: object[] = []
    for (let i = 0; i < nodesPerAgent; i++) {
        actions.push({
            type: 'create_node',
            title: `Perf E2E Node ${i}`,
            summary: `Synthetic node ${i} produced by e2e perf-agent-storm.`,
            content: `Node body for index ${i}. Generated by the e2e perf harness.`,
        })
    }
    actions.push({ type: 'exit', code: 0 })
    return { actions }
}

function buildAgentPrompt(script: object): string {
    return `### FAKE_AGENT_SCRIPT ###\n${JSON.stringify(script)}\n### END_FAKE_AGENT_SCRIPT ###`
}

function resolveRepoRoot(): string {
    // webapp/e2e-tests/.../perf/electron-agent-storm-perf.spec.ts
    // → ../../../../.. is the worktree root
    return path.resolve(__dirname, '..', '..', '..', '..', '..', '..')
}

function resolveFakeAgentEntrypoint(): { dir: string; entry: string } {
    const repoRoot = resolveRepoRoot()
    const dir = path.join(repoRoot, 'tools', 'vt-fake-agent')
    const entry = path.join(dir, 'src', 'index.ts')
    if (!existsSync(entry)) throw new Error(`vt-fake-agent entrypoint not found at ${entry}`)
    return { dir, entry }
}

function resolveTsxImportPath(): string {
    return require.resolve('tsx')
}

// ─── MCP port discovery from .mcp.json (prod-shape contract) ─────────────

async function readMcpPort(mcpJsonPath: string, timeoutMs: number): Promise<number> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (existsSync(mcpJsonPath)) {
            try {
                const raw = readFileSync(mcpJsonPath, 'utf8')
                const parsed = JSON.parse(raw) as { mcpServers?: Record<string, { url?: string }> }
                const url = parsed.mcpServers?.voicetree?.url
                if (typeof url === 'string') {
                    const m = url.match(/:(\d+)\/mcp$/)
                    if (m) return Number.parseInt(m[1], 10)
                }
            } catch {
                // file mid-write; try again
            }
        }
        await new Promise(r => setTimeout(r, 250))
    }
    throw new Error(`timed out waiting for ${mcpJsonPath} with mcpServers.voicetree.url`)
}

// ─── graph-db-server native binding check (mirrors realistic-perf spec) ───

const PROJECT_ROOT = path.resolve(process.cwd())

function canLoadNativeGraphDbModules(nodeBin: string): boolean {
    try {
        execFileSync(nodeBin, ['-e', "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(':memory:').close()"], {
            cwd: path.resolve(PROJECT_ROOT, '..'),
            stdio: 'ignore',
        })
        return true
    } catch {
        return false
    }
}

function resolveGraphDaemonNodeBin(): string {
    const nvmNodeBin = path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.20.0', 'bin', 'node')
    const candidates = [
        process.env.VT_GRAPHD_NODE_BIN,
        process.env.npm_node_execpath,
        process.execPath,
        existsSync(nvmNodeBin) ? nvmNodeBin : undefined,
        'node',
    ].filter((c): c is string => Boolean(c))
    return candidates.find(canLoadNativeGraphDbModules) ?? process.execPath
}

// ─── Fixtures (one-shot, single test) ────────────────────────────────────

interface StormFixtures {
    electronApp: ElectronApplication
    appWindow: Page
    args: E2EArgs
    vaultPath: string
    appSupportPath: string
    vaultLayout: VaultLayout
    mcpPort: number
    mainInspectPort: number
}

const test = base.extend<StormFixtures>({
    args: async ({}, use) => {
        await use(parseArgs())
    },

    vaultPath: async ({}, use) => {
        // Vault sits inside a per-run temp project dir so the app's project
        // picker has a reasonable name.
        const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'vt-e2e-storm-project-'))
        const vault = path.join(projectRoot, 'perf-vault')
        await use(vault)
        // Cleanup happens in `electronApp` teardown so the order is
        // electron-close → vault-rm → orphan-reap.
    },

    appSupportPath: async ({}, use) => {
        const appSupport = mkdtempSync(path.join(os.tmpdir(), 'vt-e2e-storm-app-'))
        await use(appSupport)
    },

    vaultLayout: async ({ vaultPath, args }, use) => {
        if (args.vaultSeedNodeCount < args.agents) {
            throw new Error(
                `PERF_E2E_VAULT_SEED_NODES (${args.vaultSeedNodeCount}) < PERF_E2E_AGENTS (${args.agents}); `
                + `each agent needs a distinct first-cluster anchor`,
            )
        }
        const layout = generateVaultOnDisk(vaultPath, args.vaultSeedNodeCount)
        console.log(`[E2E Storm] seeded vault with ${layout.nodes.length} nodes at ${vaultPath}`)
        await use(layout)
    },

    electronApp: async ({ args, vaultPath, appSupportPath, vaultLayout: _vaultLayout }, use) => {
        // Seed projects.json so the picker shows the vault project. We point
        // `path` AND `voicetreeInitialized: true` at the vault so the app
        // opens straight into graph view on click.
        const projectsPath = path.join(appSupportPath, 'projects.json')
        const projectName = path.basename(path.dirname(vaultPath))
        await fs.writeFile(
            projectsPath,
            JSON.stringify([{
                id: 'e2e-storm-perf-project',
                path: path.dirname(vaultPath),
                name: projectName,
                type: 'folder',
                lastOpened: Date.now(),
                voicetreeInitialized: true,
            }], null, 2),
            'utf8',
        )

        const configPath = path.join(appSupportPath, 'voicetree-config.json')
        await fs.writeFile(
            configPath,
            JSON.stringify({
                lastDirectory: path.dirname(vaultPath),
                vaultConfig: {
                    [path.dirname(vaultPath)]: {
                        writePath: vaultPath,
                        readPaths: [],
                    },
                },
            }, null, 2),
            'utf8',
        )

        const INSPECT_PORT = 9234
        const electronApp = await electron.launch({
            args: [
                `--inspect=${INSPECT_PORT}`,
                path.join(PROJECT_ROOT, 'dist-electron/main/index.js'),
                `--user-data-dir=${appSupportPath}`,
            ],
            env: {
                ...process.env,
                NODE_ENV: 'test',
                HEADLESS_TEST: process.env.HEADLESS_TEST ?? '1',
                MINIMIZE_TEST: process.env.MINIMIZE_TEST ?? '1',
                VOICETREE_PERSIST_STATE: '1',
                VOICETREE_DAEMON_LOAD_TIMEOUT_MS: '180000',
                VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(),
            },
            timeout: 30_000,
        })

        // Surface [load-timing] from the bundled main.
        const mainStdout = electronApp.process().stdout
        if (mainStdout) {
            mainStdout.on('data', (chunk: Buffer) => {
                const text = chunk.toString()
                for (const line of text.split('\n')) {
                    if (line.startsWith('[load-timing]') || line.includes('[e2e-storm]')) {
                        console.log(line)
                    }
                }
            })
        }

        await use(electronApp)

        // ─── teardown ─────────────────────────────────────────────────────
        try {
            const win = await electronApp.firstWindow()
            await win.evaluate(async () => {
                const api = (window as unknown as {
                    electronAPI?: { main?: { stopFileWatching?: () => Promise<void> } }
                }).electronAPI
                if (api?.main?.stopFileWatching) await api.main.stopFileWatching()
            })
            await win.waitForTimeout(300)
        } catch {
            // ignore
        }
        await electronApp.close()

        // tear down agent-runtime tmux sessions before removing vault dir
        try { agentRuntime.getTerminalManager().cleanup() } catch { /* may be unconfigured if early failure */ }

        if (!args.keepArtifacts) {
            await fs.rm(path.dirname(vaultPath), { recursive: true, force: true })
            await fs.rm(appSupportPath, { recursive: true, force: true })
        } else {
            console.log(`[E2E Storm] artifacts kept: vault=${vaultPath} appSupport=${appSupportPath}`)
        }

        const reaped = killOrphanVtGraphdDaemons()
        if (reaped.killed.length > 0) {
            console.log('[E2E Storm] Reaped orphan vt-graphd daemons', reaped.killed)
        }
    },

    appWindow: async ({ electronApp }, use) => {
        const win = await electronApp.firstWindow({ timeout: 30_000 })
        win.on('console', (msg) => {
            const t = msg.type()
            if (t === 'error' || t === 'warning') console.log(`BROWSER [${t}]:`, msg.text())
        })
        win.on('pageerror', (err) => console.error('PAGE ERROR:', err.message))
        await win.waitForLoadState('domcontentloaded')
        await use(win)
    },

    mcpPort: async ({ vaultPath, appWindow }, use) => {
        // Click into the seeded project so the app opens the vault and writes
        // .mcp.json. We target by `data-testid` rather than visible text — the
        // text-match approach is brittle when the temp project name happens
        // to span the layout (a 'visible / enabled / stable' check fails while
        // the picker is still settling on a cold-boot Onidel disk).
        await appWindow.waitForSelector('text=Voicetree', { timeout: 30_000 })
        const projectName = path.basename(path.dirname(vaultPath))
        const projectBtn = appWindow.locator('button[data-testid="saved-project-button"]').first()
        await projectBtn.waitFor({ state: 'visible', timeout: 30_000 })
        await projectBtn.click({ timeout: 60_000 })
        console.log(`[E2E Storm] Clicked project '${projectName}' to enter graph view`)

        const mcpJsonPath = path.join(vaultPath, '.mcp.json')
        const port = await readMcpPort(mcpJsonPath, 90_000)
        console.log(`[E2E Storm] discovered MCP port=${port} from ${mcpJsonPath}`)
        await use(port)
    },

    mainInspectPort: async ({}, use) => {
        // Must match the value passed into --inspect= above. Hardcoded here
        // mirrors the existing CDP perf spec; the only consumer of this value
        // is the main-process CDP profiler, which polls /json/list on the port.
        await use(9234)
    },
})

// ─── The test ────────────────────────────────────────────────────────────

interface AgentResult {
    readonly terminalId: string
    readonly spawnSuccess: boolean
    readonly startedAtMs: number
    readonly exitedAtMs: number | null
    readonly exitCode: number | null
    readonly stdoutSnippet: string
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
        const rec = agentRuntime.getTerminalRecords().find(r => r.terminalId === terminalId)
        if (rec?.status === 'exited') {
            const entry = { code: 0, atMs: Date.now() }
            exitedTerminals.set(terminalId, entry)
            return entry
        }
        await new Promise(r => setTimeout(r, 250))
    }
    return null
}

test.describe('E2E Electron + agent storm perf', () => {
    // Fixture setup includes vite build (already done by `pretest`), Electron
    // boot, project picker click, and .mcp.json polling — well over the config
    // default of 90s on a cold Onidel disk. Override here so fixture setup is
    // not strangled by the test-level timeout before we enter the body.
    test.describe.configure({ timeout: 15 * 60_000 })

    test('storm a real Electron-launched daemon with N fake-agents and report three-tracer + CDP timeline', async ({
        electronApp: _electronApp,
        appWindow,
        args,
        vaultPath,
        appSupportPath,
        vaultLayout,
        mcpPort,
        mainInspectPort,
    }) => {
        // ~3 min for boot + storm + report write; bumped if global timeout is.
        test.setTimeout(args.globalTimeoutMs + 90_000)

        // ── Configure agent-runtime in THIS process for spawning only.
        // No daemon, no MCP server, no graph bridge — those all live in the
        // Electron app. We only need the tmux-backed terminal-manager.
        configureAgentRuntime({
            env: {
                getAppSupportPath: () => appSupportPath,
                getMcpPort: () => mcpPort,
            },
        })
        await agentRuntime.ensureTmuxAvailable()
        await agentRuntime.ensureTmuxServer()

        // ── Snapshot trace offsets BEFORE the storm window.
        const traceDir = path.join(os.homedir(), '.voicetree', 'traces')
        const graphdNdjson = path.join(traceDir, 'vt-graphd.ndjson')
        const electronNdjson = path.join(traceDir, 'vt-electron-daemon.ndjson')
        const rendererNdjson = path.join(traceDir, 'vt-renderer.ndjson')
        const graphdOffset = ndjsonFileSize(graphdNdjson)
        const electronOffset = ndjsonFileSize(electronNdjson)
        const rendererOffset = ndjsonFileSize(rendererNdjson)

        // ── CDP wiring: renderer profiler + main-process profiler + metric snapshots.
        const cdp = await appWindow.context().newCDPSession(appWindow)
        await cdp.send('Profiler.enable')
        await cdp.send('Performance.enable')
        await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
        await cdp.send('Profiler.start')

        await startMainProcessProfile(mainInspectPort)
        console.log('[E2E Storm] Main + renderer profilers started')

        const cdpRendererBefore = await cdp.send('Performance.getMetrics') as {
            metrics: Array<{ name: string; value: number }>
        }

        const { dir: fakeAgentDir, entry: fakeAgentEntrypoint } = resolveFakeAgentEntrypoint()
        const tsxImportPath = resolveTsxImportPath()

        const outputs = new Map<string, string>()
        const exitedTerminals = new Map<string, { code: number; atMs: number }>()
        const onData = (id: string, data: string): void => {
            outputs.set(id, (outputs.get(id) ?? '') + data)
        }
        const onExit = (id: string, exitCode: number): void => {
            if (!exitedTerminals.has(id)) exitedTerminals.set(id, { code: exitCode, atMs: Date.now() })
        }

        const script = buildFakeAgentScript(args.nodesPerAgent)
        const agentPrompt = buildAgentPrompt(script)

        // ── Storm window starts here.
        const wallStart = Date.now()
        const agentLaunches: Promise<AgentResult>[] = []
        for (let i = 0; i < args.agents; i++) {
            const terminalId = `e2e-storm-agent-${i}` as TerminalId
            const seedNode = i < vaultLayout.firstClusterNodePaths.length
                ? vaultLayout.firstClusterNodePaths[i]
                : vaultLayout.nodes[i % vaultLayout.nodes.length].relativePath
            const attachedToNodeId = path.join(vaultPath, seedNode)
            const td: TerminalData = createTerminalData({
                terminalId,
                attachedToNodeId,
                terminalCount: i,
                title: terminalId,
                agentName: terminalId,
                isHeadless: true,
                initialEnvVars: {
                    VOICETREE_TERMINAL_ID: terminalId,
                    VOICETREE_MCP_PORT: String(mcpPort),
                    VOICETREE_VAULT_PATH: vaultPath,
                    TASK_NODE_PATH: `${vaultPath}/${terminalId}-task.md`,
                    AGENT_PROMPT: agentPrompt,
                },
                initialCommand: `${JSON.stringify(process.execPath)} --import ${JSON.stringify(tsxImportPath)} ${JSON.stringify(fakeAgentEntrypoint)}; exit`,
                executeCommand: true,
                initialSpawnDirectory: fakeAgentDir,
            })

            const startedAtMs = Date.now()
            agentLaunches.push((async (): Promise<AgentResult> => {
                const spawn = await agentRuntime.getTerminalManager().spawnTmuxBacked({
                    terminalData: td,
                    getToolsDirectory: () => fakeAgentDir,
                    onData,
                    onExit,
                })
                if (!spawn.success) {
                    return {
                        terminalId,
                        spawnSuccess: false,
                        startedAtMs,
                        exitedAtMs: Date.now(),
                        exitCode: -1,
                        stdoutSnippet: outputs.get(terminalId) ?? '',
                        errorMessage: spawn.error ?? 'spawn failed',
                    }
                }
                const exit = await waitForExit(terminalId, exitedTerminals, args.perAgentTimeoutMs)
                const combined = (outputs.get(terminalId) ?? '')
                    + agentRuntime.getHeadlessAgentOutput(terminalId)
                return {
                    terminalId,
                    spawnSuccess: true,
                    startedAtMs,
                    exitedAtMs: exit?.atMs ?? null,
                    exitCode: exit?.code ?? null,
                    stdoutSnippet: combined.slice(0, 2000),
                }
            })())
        }

        const globalDeadline = new Promise<void>((_, reject) =>
            setTimeout(() => reject(new Error(`global timeout ${args.globalTimeoutMs}ms exceeded`)), args.globalTimeoutMs),
        )
        let agentResults: AgentResult[] = []
        try {
            agentResults = await Promise.race([
                Promise.all(agentLaunches),
                globalDeadline.then(() => [] as AgentResult[]),
            ])
        } catch (err) {
            console.error(`[E2E Storm] ${(err as Error).message}`)
            agentResults = await Promise.all(agentLaunches.map(p => p.catch((): AgentResult => ({
                terminalId: 'unknown',
                spawnSuccess: false,
                startedAtMs: wallStart,
                exitedAtMs: null,
                exitCode: null,
                stdoutSnippet: '',
                errorMessage: 'promise rejected',
            }))))
        }
        const wallMs = Date.now() - wallStart
        // ── Storm window ends here.

        const cdpRendererAfter = await cdp.send('Performance.getMetrics') as {
            metrics: Array<{ name: string; value: number }>
        }

        // ── Stop renderer profiler; save .cpuprofile.
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const reportsDir = path.join(os.homedir(), '.voicetree', 'reports')
        mkdirSync(reportsDir, { recursive: true })

        const rendererProfilePath = path.join(reportsDir, `perf-agent-storm-e2e-renderer-${timestamp}.cpuprofile`)
        const rendererStop = await cdp.send('Profiler.stop') as { profile?: unknown }
        if (rendererStop.profile) {
            writeFileSync(rendererProfilePath, JSON.stringify(rendererStop.profile, null, 2), 'utf8')
            const metrics = analyzeMainProcessProfile(JSON.stringify(rendererStop.profile))
            console.log('\n[E2E Storm] RENDERER CPU PROFILE:')
            printMainProcessMetrics(metrics)
        }

        // ── Stop main-process profiler; save .cpuprofile.
        const mainProfilePath = await stopMainProcessProfileAndSave(
            reportsDir,
            `perf-agent-storm-e2e-main-${timestamp}.cpuprofile`,
        )
        const mainProfileJson = await fs.readFile(mainProfilePath, 'utf8')
        const mainMetrics = analyzeMainProcessProfile(mainProfileJson)
        console.log('\n[E2E Storm] MAIN PROCESS CPU PROFILE:')
        printMainProcessMetrics(mainMetrics)

        // ── Tail trace files; summarize.
        const graphdSpans = readNdjsonTail(graphdNdjson, graphdOffset)
        const electronSpans = readNdjsonTail(electronNdjson, electronOffset)
        const rendererSpans = readNdjsonTail(rendererNdjson, rendererOffset)
        const graphdSummary = summarizeSpans(graphdSpans)
        const electronSummary = summarizeSpans(electronSpans)
        const rendererSummary = summarizeSpans(rendererSpans)

        const filesCreated = countMarkdownFiles(vaultPath)
        const completedCount = agentResults.filter(r => r.exitCode === 0).length
        const failedCount = agentResults.filter(r => r.exitedAtMs !== null && r.exitCode !== 0).length
        const timedOutCount = agentResults.filter(r => r.exitedAtMs === null).length

        const report = {
            args: { ...args, variant: 'e2e' as const },
            wallMs,
            agentCount: agentResults.length,
            completedCount,
            failedCount,
            timedOutCount,
            filesCreated,
            vaultPath,
            appSupportPath,
            spans: {
                vtGraphd: graphdSummary,
                vtElectronDaemon: electronSummary,
                vtRenderer: rendererSummary,
            },
            cdp: {
                mainMetrics: {
                    // Performance.getMetrics is only meaningful for the renderer
                    // via this CDP session; main-process before/after surfaces are
                    // captured implicitly via the .cpuprofile sampler.
                    note: 'See cdp.profiles.main for the sampling profile spanning the storm window',
                },
                rendererMetrics: {
                    before: cdpRendererBefore.metrics,
                    after: cdpRendererAfter.metrics,
                },
                profiles: {
                    main: mainProfilePath,
                    renderer: rendererProfilePath,
                },
            },
            agents: agentResults,
        }

        const reportPath = path.join(reportsDir, `perf-agent-storm-e2e-${timestamp}.json`)
        writeFileSync(reportPath, JSON.stringify(report, null, 2), 'utf8')

        // ── Console summary.
        const sep = '='.repeat(70)
        console.log(`\n${sep}`)
        console.log('  E2E AGENT-STORM PERF — SUMMARY')
        console.log(sep)
        console.log(`  agents:        ${args.agents} requested, ${completedCount} ok, ${failedCount} failed, ${timedOutCount} timed out`)
        console.log(`  nodes/agent:   ${args.nodesPerAgent}`)
        console.log(`  wall time:     ${wallMs}ms`)
        console.log(`  files written: ${filesCreated} (${(filesCreated / Math.max(1, wallMs / 1000)).toFixed(1)}/sec)`)
        console.log(`  vt-graphd spans (new):           ${graphdSummary.totalNew}`)
        for (const [name, n] of Object.entries(graphdSummary.byName).sort()) {
            const d = graphdSummary.durationsMs[name]
            console.log(`    ${name.padEnd(40)}  n=${String(n).padStart(5)}  p50=${d.p50.toFixed(1)}ms  p95=${d.p95.toFixed(1)}ms  max=${d.max.toFixed(1)}ms`)
        }
        console.log(`  vt-electron-daemon spans (new): ${electronSummary.totalNew}`)
        for (const [name, n] of Object.entries(electronSummary.byName).sort()) {
            const d = electronSummary.durationsMs[name]
            console.log(`    ${name.padEnd(40)}  n=${String(n).padStart(5)}  p50=${d.p50.toFixed(1)}ms  p95=${d.p95.toFixed(1)}ms  max=${d.max.toFixed(1)}ms`)
        }
        console.log(`  vt-renderer spans (new):         ${rendererSummary.totalNew}`)
        if (rendererSummary.totalNew === 0) {
            console.log('    (renderer tracer not yet implemented — see RENDERER SPAN SPEC at top of file)')
        }
        const heapBefore = cdpRendererBefore.metrics.find(m => m.name === 'JSHeapUsedSize')?.value ?? 0
        const heapAfter = cdpRendererAfter.metrics.find(m => m.name === 'JSHeapUsedSize')?.value ?? 0
        console.log(`  renderer JS heap (after):        ${(heapAfter / 1024 / 1024).toFixed(1)} MB (delta ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(1)} MB)`)
        console.log(`  report:        ${reportPath}`)
        console.log(`  cpuprofiles:   ${mainProfilePath}\n                 ${rendererProfilePath}`)
        console.log(sep)

        // ── v1 assertions: structural only, no latency thresholds.
        if (agentResults.length !== args.agents) {
            throw new Error(`expected ${args.agents} agent results, got ${agentResults.length}`)
        }
        if (completedCount !== args.agents) {
            throw new Error(
                `expected ${args.agents} agents to complete, got ${completedCount} (failed=${failedCount}, timed-out=${timedOutCount})`,
            )
        }
        if (graphdSummary.totalNew <= 0) {
            throw new Error('expected vt-graphd spans to be emitted during storm; got zero')
        }
        if (electronSummary.totalNew <= 0) {
            throw new Error(
                'expected vt-electron-daemon spans to be emitted during storm; got zero — '
                + 'electron-main observability did not run, or the trace file is wrong',
            )
        }
        // No assertion on rendererSummary.totalNew — that requires the renderer
        // tracer follow-up.
    })
})

export { test }

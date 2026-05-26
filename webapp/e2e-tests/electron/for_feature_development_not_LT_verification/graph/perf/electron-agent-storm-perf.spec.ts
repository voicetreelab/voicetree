/**
 * E2E PERF TEST: real Electron app + real daemon + real agent storm.
 *
 * Diagonal cell that `agent-storm.ts` and the existing CDP perf specs do NOT
 * cover: a real Electron VoiceTree main bundle driven under an external
 * fake-agent storm. Daemon, electron-main, renderer, cytoscape, chokidar,
 * SQLite, and disk all run real; only the fake-agents are "mocked".
 *
 * Pipeline:
 *   1. Seed temp `userData` + a fresh realistic vault via @vt/perf-fixtures.
 *   2. Launch `dist-electron/main/index.js` with --inspect=<port>.
 *   3. Read MCP port from <vault>/.mcp.json (prod-shape discovery).
 *   4. Snapshot byte offsets of the OTel NDJSON trace files.
 *   5. Start CDP main + renderer CPU profilers.
 *   6. Spawn N tmux-backed vt-fake-agents pointing at the discovered MCP port.
 *   7. Await each agent's exit.
 *   8. Read NDJSON tails, aggregate spans, save .cpuprofile files, emit
 *      JSON report at ~/.voicetree/reports/perf-agent-storm-e2e-<ts>.json.
 *
 * Routing: invoked as `npm run test:perf:e2e-storm` (Onidel via run-remote.mjs)
 *   or `:local` for direct invocation. xvfb wrapped via
 *   packages/measures/src/_runners/run-with-xvfb-if-needed.ts.
 *
 * Renderer span spec (deferred): see notes in
 *   /Users/bobbobby/repos/voicetree-public/voicetree-26-5/stableperfprofilecollection.md
 *   — the `vt-renderer` tracer is a follow-up; this spec tolerates its absence.
 */

import { test as base, _electron as electron } from '@playwright/test'
import type { ElectronApplication, Page } from '@playwright/test'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    writeFileSync,
} from 'node:fs'
import * as os from 'node:os'

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
import {
    parseArgs,
    type E2EArgs,
    type AgentResult,
    ndjsonFileSize,
    readNdjsonTail,
    summarizeSpans,
    countMarkdownFiles,
    buildFakeAgentScript,
    buildAgentPrompt,
    resolveFakeAgentEntrypoint,
    resolveTsxImportPath,
    readMcpPort,
    resolveGraphDaemonNodeBin,
    waitForExit,
    printStormSummary,
    seedUserData,
} from './perf-helpers/agentStormE2eHelpers'

const PROJECT_ROOT = path.resolve(process.cwd())

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
        const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'vt-e2e-storm-project-'))
        const vault = path.join(projectRoot, 'perf-vault')
        await use(vault)
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
        await seedUserData(fs, appSupportPath, vaultPath)
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
                VT_GRAPHD_NODE_BIN: resolveGraphDaemonNodeBin(PROJECT_ROOT),
            },
            timeout: 30_000,
        })

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
        // .mcp.json. `force: true` bypasses Playwright's `stable` actionability
        // heuristic, which never resolves under cold-boot xvfb headful (the
        // picker page is in a continuous re-render). If the click misses, the
        // subsequent `.mcp.json` poll will fail loudly.
        await appWindow.waitForSelector('text=Voicetree', { timeout: 30_000 })
        const projectName = path.basename(path.dirname(vaultPath))
        const projectBtn = appWindow.locator('button[data-testid="saved-project-button"]').first()
        await projectBtn.waitFor({ state: 'visible', timeout: 30_000 })
        await projectBtn.click({ timeout: 60_000, force: true })
        console.log(`[E2E Storm] Clicked project '${projectName}' to enter graph view`)

        // .mcp.json is written by voicetree-mcp at the *project root*
        // (= the dir we put in projects.json), which is the parent of the
        // write-folder vault. Not inside the vault itself.
        const mcpJsonPath = path.join(path.dirname(vaultPath), '.mcp.json')
        const port = await readMcpPort(mcpJsonPath, 90_000)
        console.log(`[E2E Storm] discovered MCP port=${port} from ${mcpJsonPath}`)
        await use(port)
    },

    mainInspectPort: async ({}, use) => {
        await use(9234)
    },
})

// ─── The test ────────────────────────────────────────────────────────────

test.describe('E2E Electron + agent storm perf', () => {
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
        test.setTimeout(args.globalTimeoutMs + 90_000)

        configureAgentRuntime({
            env: {
                getAppSupportPath: () => appSupportPath,
                getMcpPort: () => mcpPort,
            },
        })
        await agentRuntime.ensureTmuxAvailable()
        await agentRuntime.ensureTmuxServer()

        const traceDir = path.join(os.homedir(), '.voicetree', 'traces')
        const graphdNdjson = path.join(traceDir, 'vt-graphd.ndjson')
        const electronNdjson = path.join(traceDir, 'vt-electron-daemon.ndjson')
        const rendererNdjson = path.join(traceDir, 'vt-renderer.ndjson')
        const graphdOffset = ndjsonFileSize(graphdNdjson)
        const electronOffset = ndjsonFileSize(electronNdjson)
        const rendererOffset = ndjsonFileSize(rendererNdjson)

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
        const getTerminalStatus = (id: string): string | undefined =>
            agentRuntime.getTerminalRecords().find(r => r.terminalId === id)?.status

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
                const exit = await waitForExit(terminalId, exitedTerminals, getTerminalStatus, args.perAgentTimeoutMs)
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

        const mainProfilePath = await stopMainProcessProfileAndSave(
            reportsDir,
            `perf-agent-storm-e2e-main-${timestamp}.cpuprofile`,
        )
        const mainProfileJson = await fs.readFile(mainProfilePath, 'utf8')
        const mainMetrics = analyzeMainProcessProfile(mainProfileJson)
        console.log('\n[E2E Storm] MAIN PROCESS CPU PROFILE:')
        printMainProcessMetrics(mainMetrics)

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

        const heapBeforeBytes = cdpRendererBefore.metrics.find(m => m.name === 'JSHeapUsedSize')?.value ?? 0
        const heapAfterBytes = cdpRendererAfter.metrics.find(m => m.name === 'JSHeapUsedSize')?.value ?? 0
        printStormSummary({
            args,
            completedCount,
            failedCount,
            timedOutCount,
            wallMs,
            filesCreated,
            graphdSummary,
            electronSummary,
            rendererSummary,
            heapBeforeBytes,
            heapAfterBytes,
            reportPath,
            mainProfilePath,
            rendererProfilePath,
        })

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
    })
})

export { test }

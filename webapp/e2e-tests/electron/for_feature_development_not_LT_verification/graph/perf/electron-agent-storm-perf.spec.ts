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

import { expect as _expect } from '@playwright/test'
import * as path from 'node:path'
import * as fs from 'node:fs/promises'
import { mkdirSync, writeFileSync } from 'node:fs'
import * as os from 'node:os'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

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
    buildAgentPrompt,
    buildFakeAgentScript,
    countMarkdownFiles,
    ndjsonFileSize,
    readNdjsonTail,
    resolveFakeAgentEntrypoint,
    summarizeSpans,
} from './perf-helpers/stormHelpers'
import { makeStormTest } from './perf-helpers/stormFixtures'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)
const PROJECT_ROOT = path.resolve(process.cwd())

function resolveTsxImportPath(): string {
    return require.resolve('tsx')
}

const test = makeStormTest(PROJECT_ROOT)


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
        daemonUrl,
        mainInspectPort,
    }) => {
        // ~3 min for boot + storm + report write; bumped if global timeout is.
        test.setTimeout(args.globalTimeoutMs + 90_000)

        // ── Configure agent-runtime in THIS process for spawning only.
        // No daemon, no graph bridge — those live in the Electron app. We
        // only need the tmux-backed terminal-manager here.
        configureAgentRuntime({
            env: {
                getAppSupportPath: () => appSupportPath,
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

        const { dir: fakeAgentDir, entry: fakeAgentEntrypoint } = resolveFakeAgentEntrypoint(__dirname)
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
                    // Step 7g discovery chain for spawned subprocesses: full
                    // daemon URL via $VOICETREE_DAEMON_URL, bearer token read
                    // from `${VOICETREE_VAULT_PATH}/.voicetree/auth-token` at
                    // fire time. The legacy $VOICETREE_MCP_PORT is gone.
                    VOICETREE_DAEMON_URL: daemonUrl,
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

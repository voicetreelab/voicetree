/**
 * e2e-storm-mvp orchestrator.
 *
 * Minimal end-to-end perf-architecture smoke: launches the real Electron
 * VoiceTree main bundle, lets it boot the daemon + MCP server against a
 * freshly seeded vault, discovers the MCP port from `.mcp.json`, spawns 30
 * vt-fake-agents that each create 5 nodes via real MCP, then asserts the
 * expected markdown files landed on disk.
 *
 * The harness captures one process at a time. vt-graphd uses the in-process
 * perf probe; Electron main is captured externally through its Node inspector
 * port so production Electron source stays out of the measurement contract.
 *
 * Run:
 *   node --import tsx packages/measures/perf/e2e-storm-mvp/index.ts
 *
 * Exit code: 0 on pass, 1 on fail.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { homedir, tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { Page } from '@playwright/test'

import { killOrphanVtGraphdDaemons } from '@vt/graph-db-client'
import { generateVaultOnDisk } from '@vt/perf-fixtures'

import { launchElectronAndDiscoverMcp } from './launchElectron.ts'
import { runFakeAgent, buildMultiCreateNodeScript, type FakeAgentResult } from './runFakeAgent.ts'
import { countMarkdownFiles, writeReportAndSummary } from './report.ts'
import { flushAndStopVtGraphd, forceStopVtGraphd } from './perfProfile.ts'
import { startHostVmMetricsSampler, type HostVmMetricsSummary, type HostVmMetricsSampler } from './hostVmMetrics.ts'
import { uploadV8CpuProfileToPyroscope } from './pyroscopeProfile.ts'
import { createOtelMetricSink } from './otelMetricSink.ts'
import {
    startMainProcessProfile,
    stopMainProcessProfileAndSave,
    type MainProcessCdpHandle,
} from '../_shared/main-process-cdp.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// measures/perf/e2e-storm-mvp -> measures/perf -> measures -> packages -> repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const DEFAULT_AGENT_COUNT = 30
const DEFAULT_NODES_PER_AGENT = 5

interface Args {
    readonly keepArtifacts: boolean
    readonly mcpDiscoveryTimeoutMs: number
    readonly agentTimeoutMs: number
    readonly inspectPort: number
    readonly outPath: string | null
    readonly agentCount: number
    readonly nodesPerAgent: number
}

interface RunContext {
    readonly runUuid: string
    readonly runDir: string
    readonly otlpEndpoint?: string
    readonly perfEnv: Readonly<Record<string, string>>
}

function percentile(sorted: readonly number[], p: number): number {
    if (sorted.length === 0) return 0
    const index = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))]
}

function durationStats(values: readonly number[]) {
    const sorted = [...values].sort((a, b) => a - b)
    return {
        p50: percentile(sorted, 50),
        p99: percentile(sorted, 99),
        max: sorted[sorted.length - 1] ?? 0,
    }
}

function wallTimeStats(results: readonly FakeAgentResult[]) {
    return durationStats(results.map(r => r.wallMs))
}

function spawnTimeStats(results: readonly FakeAgentResult[]) {
    return durationStats(results.map(r => r.spawnWallMs))
}

interface MainProcessSnapshot {
    readonly cpu: {
        readonly user: number
        readonly system: number
    }
    readonly memory: {
        readonly rss: number
        readonly heapUsed: number
        readonly heapTotal: number
        readonly external: number
        readonly arrayBuffers: number
    }
}

async function readMainProcessSnapshot(handle: MainProcessCdpHandle): Promise<MainProcessSnapshot> {
    const response = await handle.send('Runtime.evaluate', {
        expression: 'JSON.stringify({ cpu: process.cpuUsage(), memory: process.memoryUsage() })',
        returnByValue: true,
    })
    const value = response.result?.result
    if (!value || typeof value !== 'object' || !('value' in value) || typeof value.value !== 'string') {
        throw new Error(`Runtime.evaluate returned no process snapshot (${response.error?.message ?? 'unknown'})`)
    }
    return JSON.parse(value.value) as MainProcessSnapshot
}

async function startMainProcessMetricsSampler(
    handle: MainProcessCdpHandle,
    env: { readonly otlpEndpoint?: string; readonly instanceId?: string },
): Promise<() => Promise<void>> {
    const managedMeter = createOtelMetricSink({
        serviceName: 'vt-electron-main',
        meterName: 'vt-e2e-storm-mvp',
        otlpEndpoint: env.otlpEndpoint,
        instanceId: env.instanceId,
    })
    const meter = managedMeter.meter
    const cpuCounter = meter.createCounter('process.cpu.time', {
        description: 'Electron main CPU time consumed between e2e-storm CDP samples.',
        unit: 's',
    })
    let latestSnapshot: MainProcessSnapshot | null = null
    meter.createObservableGauge('process.memory.usage', {
        description: 'Electron main memory usage sampled via CDP Runtime.evaluate.',
        unit: 'By',
    }).addCallback((result) => {
        const memory = latestSnapshot?.memory
        if (!memory) return
        result.observe(memory.rss, { type: 'rss' })
        result.observe(memory.heapUsed, { type: 'heap_used' })
        result.observe(memory.heapTotal, { type: 'heap_total' })
        result.observe(memory.external, { type: 'external' })
        result.observe(memory.arrayBuffers, { type: 'array_buffers' })
    })

    let previousCpu = (await readMainProcessSnapshot(handle)).cpu
    let stopped = false

    const writeRow = async (): Promise<void> => {
        if (stopped) return
        const snapshot = await readMainProcessSnapshot(handle)
        cpuCounter.add((snapshot.cpu.user - previousCpu.user) / 1_000_000, { type: 'user' })
        cpuCounter.add((snapshot.cpu.system - previousCpu.system) / 1_000_000, { type: 'system' })
        previousCpu = snapshot.cpu
        latestSnapshot = snapshot
    }

    const interval = setInterval(() => {
        void writeRow().catch((error: unknown) => {
            process.stderr.write(`[mvp] electron-main metrics sample failed: ${(error as Error).message}\n`)
        })
    }, 1000)
    interval.unref()

    return async () => {
        if (stopped) return
        clearInterval(interval)
        await writeRow()
        stopped = true
        await managedMeter.forceFlush()
        await managedMeter.shutdown()
    }
}

interface RendererCdpHandle {
    send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
    detach(): Promise<void>
}

type RendererMetric = {
    readonly name: string
    readonly value: number
}

type RendererProfileCapture = {
    readonly stop: () => Promise<void>
}

function rendererMetricValue(metrics: readonly RendererMetric[], name: string): number | undefined {
    return metrics.find(metric => metric.name === name)?.value
}

async function startRendererProfileCapture(
    appWindow: Page,
    runContext: RunContext,
): Promise<RendererProfileCapture> {
    const cdp = await appWindow.context().newCDPSession(appWindow) as RendererCdpHandle
    const managedMeter = createOtelMetricSink({
        serviceName: 'vt-renderer',
        meterName: 'vt-e2e-storm-mvp',
        otlpEndpoint: runContext.otlpEndpoint,
        instanceId: runContext.runUuid,
    })
    const profilesDir = path.join(runContext.runDir, 'profiles')
    mkdirSync(profilesDir, { recursive: true })
    let latestMetrics: readonly RendererMetric[] = []
    let stopped = false

    const meter = managedMeter.meter
    meter.createObservableGauge('process.memory.usage', {
        description: 'Renderer JavaScript heap memory sampled via CDP Performance.getMetrics.',
        unit: 'By',
    }).addCallback((result) => {
        result.observe(rendererMetricValue(latestMetrics, 'JSHeapUsedSize') ?? 0, { type: 'heap_used' })
        result.observe(rendererMetricValue(latestMetrics, 'JSHeapTotalSize') ?? 0, { type: 'heap_total' })
    })
    meter.createObservableGauge('browser.renderer.metric', {
        description: 'Renderer CDP Performance.getMetrics values for DOM and layout health.',
    }).addCallback((result) => {
        result.observe(rendererMetricValue(latestMetrics, 'Nodes') ?? 0, { metric: 'nodes' })
        result.observe(rendererMetricValue(latestMetrics, 'Documents') ?? 0, { metric: 'documents' })
        result.observe(rendererMetricValue(latestMetrics, 'LayoutCount') ?? 0, { metric: 'layout_count' })
        result.observe(rendererMetricValue(latestMetrics, 'RecalcStyleCount') ?? 0, { metric: 'recalc_style_count' })
        result.observe((rendererMetricValue(latestMetrics, 'LayoutDuration') ?? 0) * 1000, { metric: 'layout_duration_ms' })
        result.observe((rendererMetricValue(latestMetrics, 'RecalcStyleDuration') ?? 0) * 1000, { metric: 'recalc_style_duration_ms' })
        result.observe((rendererMetricValue(latestMetrics, 'ScriptDuration') ?? 0) * 1000, { metric: 'script_duration_ms' })
        result.observe((rendererMetricValue(latestMetrics, 'TaskDuration') ?? 0) * 1000, { metric: 'task_duration_ms' })
    })

    await cdp.send('Performance.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.start')

    const writeRow = async (): Promise<void> => {
        if (stopped) return
        const response = await cdp.send('Performance.getMetrics') as { readonly metrics?: readonly RendererMetric[] }
        latestMetrics = response.metrics ?? []
    }

    const interval = setInterval(() => {
        void writeRow().catch((error: unknown) => {
            process.stderr.write(`[mvp] renderer metrics sample failed: ${(error as Error).message}\n`)
        })
    }, 1000)
    interval.unref()

    return {
        stop: async () => {
            if (stopped) return
            clearInterval(interval)
            await writeRow()
            stopped = true
            const response = await cdp.send('Profiler.stop') as { readonly profile?: unknown }
            await cdp.send('Performance.disable').catch(() => undefined)
            await cdp.detach().catch(() => undefined)
            await managedMeter.forceFlush()
            await managedMeter.shutdown()
            if (!response.profile) throw new Error('Renderer Profiler.stop returned no profile')
            const cpuprofilePath = path.join(profilesDir, 'renderer.cpuprofile')
            writeFileSync(cpuprofilePath, JSON.stringify(response.profile), 'utf8')
            const upload = await uploadV8CpuProfileToPyroscope({
                cpuprofilePath,
                serviceName: 'vt-renderer',
                runUuid: runContext.runUuid,
                stoppedAtMs: Date.now(),
            })
            process.stdout.write(`[mvp] uploaded renderer profile to Pyroscope: ${upload.renderQuery}\n`)
        },
    }
}

function resolveRunContext(env: NodeJS.ProcessEnv = process.env): RunContext {
    const runUuid = env.VOICETREE_RUN_INSTANCE_ID && env.VOICETREE_RUN_INSTANCE_ID.length > 0
        ? env.VOICETREE_RUN_INSTANCE_ID
        : randomUUID()
    const runDir = path.join(homedir(), '.voicetree', 'perf', runUuid)
    const otlpEndpoint = env.VOICETREE_OTLP_ENDPOINT && env.VOICETREE_OTLP_ENDPOINT.length > 0
        ? env.VOICETREE_OTLP_ENDPOINT
        : undefined
    const perfEnv: Record<string, string> = {
        VOICETREE_RUN_INSTANCE_ID: runUuid,
        VOICETREE_PERF_PROFILE: '1',
    }
    if (otlpEndpoint !== undefined) perfEnv.VOICETREE_OTLP_ENDPOINT = otlpEndpoint
    env.VOICETREE_RUN_INSTANCE_ID = runUuid

    return { runUuid, runDir, otlpEndpoint, perfEnv }
}

function parseArgs(argv: readonly string[]): Args {
    let keepArtifacts = false
    let mcpDiscoveryTimeoutMs = 120_000
    let agentTimeoutMs = 60_000
    let inspectPort = 9244
    let outPath: string | null = null
    let agentCount = DEFAULT_AGENT_COUNT
    let nodesPerAgent = DEFAULT_NODES_PER_AGENT

    const intArg = (raw: string | undefined, name: string): number => {
        const n = Number.parseInt(raw ?? '', 10)
        if (!Number.isInteger(n) || n < 0) throw new Error(`bad --${name}: ${raw}`)
        return n
    }

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        switch (a) {
            case '--keep-artifacts': keepArtifacts = true; break
            case '--mcp-discovery-timeout-ms': mcpDiscoveryTimeoutMs = intArg(argv[++i], 'mcp-discovery-timeout-ms'); break
            case '--agent-timeout-ms': agentTimeoutMs = intArg(argv[++i], 'agent-timeout-ms'); break
            case '--inspect-port': inspectPort = intArg(argv[++i], 'inspect-port'); break
            case '--out': outPath = argv[++i] ?? null; break
            case '--agents': agentCount = intArg(argv[++i], 'agents'); break
            case '--nodes-per-agent': nodesPerAgent = intArg(argv[++i], 'nodes-per-agent'); break
            case '--help':
            case '-h':
                process.stdout.write(
                    'e2e-storm-mvp: prove headful-Electron + daemon + MCP + fake-agent end-to-end.\n'
                    + '  --agents N                    parallel fake-agents (default 30)\n'
                    + '  --nodes-per-agent N           nodes created per fake agent (default 5)\n'
                    + '  --mcp-discovery-timeout-ms MS   default 120000\n'
                    + '  --agent-timeout-ms MS           default 60000\n'
                    + '  --inspect-port N                default 9244\n'
                    + '  --keep-artifacts                keep temp dirs after the run\n'
                    + '  --out PATH                      report path (default ~/.voicetree/perf/<run-id>/e2e-storm-mvp-report.json)\n',
                )
                process.exit(0)
            default:
                throw new Error(`unknown argument: ${a}`)
        }
    }

    return { keepArtifacts, mcpDiscoveryTimeoutMs, agentTimeoutMs, inspectPort, outPath, agentCount, nodesPerAgent }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2))
    const runContext = resolveRunContext()

    const overallStart = Date.now()
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'vt-e2e-mvp-project-'))
    const projectDir = path.join(projectRoot, 'mvp-project')
    const vaultDir = path.join(projectDir, 'mvp-vault')
    mkdirSync(vaultDir, { recursive: true })

    const appSupportPath = mkdtempSync(path.join(tmpdir(), 'vt-e2e-mvp-app-'))
    const logsDir = path.join(runContext.runDir, 'logs')
    mkdirSync(logsDir, { recursive: true })
    const outPath = args.outPath ?? path.join(runContext.runDir, 'e2e-storm-mvp-report.json')
    const electronLogPath = path.join(logsDir, 'vt-electron-main.log')
    process.stdout.write(`[mvp] run id: ${runContext.runUuid}\n`)
    process.stdout.write(`[mvp] perf run dir: ${runContext.runDir}\n`)

    // Seed a small realistic vault so the daemon has nodes to attach to. The
    // single-agent MVP doesn't dogpile, but we still want the seed vault to
    // exercise the daemon's full vault-scan + index-build path.
    const vaultLayout = generateVaultOnDisk(vaultDir, 5)
    process.stdout.write(`[mvp] seeded vault: ${vaultLayout.nodes.length} nodes at ${vaultDir}\n`)

    const filesBefore = countMarkdownFiles(vaultDir)

    let pass = false
    let failureReason: string | null = null
    let mcpPort = 0
    let electronBootMs = 0
    let mcpDiscoveryMs = 0
    let agentsSucceeded = 0
    let agentsTimedOut = 0
    let agentWallMsP50 = 0
    let agentWallMsP99 = 0
    let agentWallMsMax = 0
    let agentSpawnMsP50 = 0
    let agentSpawnMsP99 = 0
    let agentSpawnMsMax = 0
    let nodesCreated = 0
    let filesAfter = filesBefore
    let app: Awaited<ReturnType<typeof launchElectronAndDiscoverMcp>>['app'] | null = null
    let electronMainProfile: MainProcessCdpHandle | null = null
    let stopElectronMainMetrics: (() => Promise<void>) | null = null
    let rendererProfile: RendererProfileCapture | null = null
    let hostVmMetrics: HostVmMetricsSampler | null = null
    let hostVmMetricsSummary: HostVmMetricsSummary | null = null

    try {
        hostVmMetrics = await startHostVmMetricsSampler({
            otlpEndpoint: runContext.otlpEndpoint,
            instanceId: runContext.runUuid,
        })
        process.stdout.write('[mvp] started devbox-vm OTEL metrics sampler\n')

        const launched = await launchElectronAndDiscoverMcp({
            repoRoot: REPO_ROOT,
            projectDir,
            vaultDir,
            appSupportPath,
            logFilePath: electronLogPath,
            inspectPort: args.inspectPort,
            mcpDiscoveryTimeoutMs: args.mcpDiscoveryTimeoutMs,
            extraEnv: runContext.perfEnv,
        })
        app = launched.app
        mcpPort = launched.mcpPort
        electronBootMs = launched.bootMs
        mcpDiscoveryMs = launched.mcpDiscoveryMs
        process.stdout.write(
            `[mvp] electron booted (${electronBootMs}ms), mcp port=${mcpPort} `
            + `(discovered in ${mcpDiscoveryMs}ms)\n`,
        )
        electronMainProfile = await startMainProcessProfile(args.inspectPort)
        stopElectronMainMetrics = await startMainProcessMetricsSampler(
            electronMainProfile,
            { otlpEndpoint: runContext.otlpEndpoint, instanceId: runContext.runUuid },
        )
        process.stdout.write('[mvp] started electron-main CDP profile + metrics sampler\n')

        // Pick the first cluster node as the agent's parent — anchors the new
        // node under a real existing node, the way real agents work.
        const seedNodeAbsolutePath = path.join(
            vaultDir,
            vaultLayout.firstClusterNodePaths[0] ?? vaultLayout.nodes[0].relativePath,
        )

        const appWindow = await app.firstWindow({ timeout: 30_000 })
        appWindow.on('pageerror', (e) => process.stderr.write(`[mvp] page error: ${e.message}\n`))
        await appWindow.waitForLoadState('domcontentloaded')
        rendererProfile = await startRendererProfileCapture(appWindow, runContext)
        process.stdout.write('[mvp] started renderer CDP profile + metrics sampler\n')

        const agentResults = await Promise.all(Array.from({ length: args.agentCount }, (_, agentIndex) => (
            runFakeAgent({
                appWindow,
                repoRoot: REPO_ROOT,
                vaultDir,
                mcpPort,
                seedNodeAbsolutePath,
                terminalId: `e2e-mvp-agent-${agentIndex}`,
                script: buildMultiCreateNodeScript(agentIndex, args.nodesPerAgent),
                timeoutMs: args.agentTimeoutMs,
            })
        )))
        const wallStats = wallTimeStats(agentResults)
        agentWallMsP50 = wallStats.p50
        agentWallMsP99 = wallStats.p99
        agentWallMsMax = wallStats.max
        const spawnStats = spawnTimeStats(agentResults)
        agentSpawnMsP50 = spawnStats.p50
        agentSpawnMsP99 = spawnStats.p99
        agentSpawnMsMax = spawnStats.max
        agentsSucceeded = agentResults.filter(result => result.spawnSuccess && result.exitedCleanly && !result.timedOut).length
        agentsTimedOut = agentResults.filter(result => result.timedOut).length

        for (const [agentIndex, result] of agentResults.entries()) {
            if (result.headlessOutput) {
                process.stdout.write(`[mvp] agent ${agentIndex} headless output:\n${result.headlessOutput}\n`)
            }
        }

        filesAfter = countMarkdownFiles(vaultDir)
        nodesCreated = filesAfter - filesBefore

        const spawnFailure = agentResults.find(result => !result.spawnSuccess)
        const scriptFailure = agentResults.find(result => result.spawnSuccess && !result.exitedCleanly && !result.timedOut)

        if (spawnFailure) {
            failureReason = `agent spawn failed: ${spawnFailure.spawnError}`
        } else if (agentsTimedOut > 0) {
            failureReason = `${agentsTimedOut} agent(s) timed out after ${args.agentTimeoutMs}ms (no [fake-agent] Executing: exit in output)`
        } else if (scriptFailure) {
            failureReason = `agent reported failure in output`
        } else if (nodesCreated !== args.agentCount * args.nodesPerAgent) {
            failureReason = `expected ${args.agentCount * args.nodesPerAgent} new markdown files, got ${nodesCreated} (before=${filesBefore}, after=${filesAfter})`
        } else {
            pass = true
        }
    } catch (err) {
        failureReason = (err as Error).message
        if ((err as Error).stack) process.stderr.write(`[mvp] ${(err as Error).stack}\n`)
    } finally {
        // Give vt-graphd a chance to flush its cpuprofile + metrics stream
        // BEFORE we tear down electron. perfProbeFromEnv writes those
        // artifacts only inside its SIGTERM/SIGINT/beforeExit handler — a
        // SIGKILL skips them, and electron's app.close() may not propagate
        // a clean signal to the daemon if it's stuck on the tmux-shutdown
        // path described below. Findng + signalling vt-graphd directly is
        // the only way to guarantee the dashboard sees its artifacts.
        const flushed = await flushAndStopVtGraphd(projectDir, 4_000)
        if (flushed.signaled.length > 0) {
            process.stdout.write(
                `[mvp] flushed vt-graphd: signaled=${JSON.stringify(flushed.signaled)} `
                + `exitedCleanly=${JSON.stringify(flushed.exitedCleanly)} `
                + `forceKilled=${JSON.stringify(flushed.forceKilled)} `
                + `stillAlive=${JSON.stringify(flushed.stillAlive)}\n`,
            )
        }

        if (app) {
            if (rendererProfile !== null) {
                try {
                    await rendererProfile.stop()
                    rendererProfile = null
                    process.stdout.write('[mvp] saved renderer CDP profile + metrics\n')
                } catch (e) {
                    process.stderr.write(`[mvp] renderer profile save failed: ${(e as Error).message}\n`)
                    failureReason ??= `renderer profile save failed: ${(e as Error).message}`
                    pass = false
                }
            }

            if (electronMainProfile !== null) {
                try {
                    await stopElectronMainMetrics?.()
                    stopElectronMainMetrics = null
                    await stopMainProcessProfileAndSave(
                        electronMainProfile,
                        path.join(runContext.runDir, 'profiles'),
                        'electron-main.cpuprofile',
                    )
                    const upload = await uploadV8CpuProfileToPyroscope({
                        cpuprofilePath: path.join(runContext.runDir, 'profiles', 'electron-main.cpuprofile'),
                        serviceName: 'vt-electron-main',
                        runUuid: runContext.runUuid,
                        stoppedAtMs: Date.now(),
                    })
                    process.stdout.write(`[mvp] uploaded electron-main profile to Pyroscope: ${upload.renderQuery}\n`)
                    electronMainProfile = null
                    process.stdout.write('[mvp] saved electron-main CDP profile + metrics\n')
                } catch (e) {
                    process.stderr.write(`[mvp] electron-main profile save failed: ${(e as Error).message}\n`)
                    failureReason ??= `electron-main profile save failed: ${(e as Error).message}`
                    pass = false
                }
            }

            // Electron's `terminal:spawn` IPC creates a TerminalRecord
            // referencing a long-lived tmux session that doesn't get torn
            // down on the agent's process.exit. There's no `terminal:dispose`
            // IPC exposed (webapp only ships `terminal:spawn`), so a graceful
            // `app.close()` hangs waiting on the orphaned tmux. We've already
            // captured every metric the report cares about by this point —
            // SIGKILL the electron process tree as the canonical exit path.
            const electronPid = app.process().pid
            process.stdout.write(`[mvp] terminating electron (teardown phase, post-flush) pid=${electronPid}\n`)
            if (electronPid !== undefined) {
                try { process.kill(electronPid, 'SIGKILL') } catch { /* already gone */ }
            }
        }

        const postElectronFlush = await forceStopVtGraphd(projectDir, 2_000)
        if (postElectronFlush.signaled.length > 0) {
            process.stdout.write(
                `[mvp] stopped post-electron vt-graphd: signaled=${JSON.stringify(postElectronFlush.signaled)} `
                + `exitedCleanly=${JSON.stringify(postElectronFlush.exitedCleanly)} `
                + `forceKilled=${JSON.stringify(postElectronFlush.forceKilled)} `
                + `stillAlive=${JSON.stringify(postElectronFlush.stillAlive)}\n`,
            )
        }

        const reaped = killOrphanVtGraphdDaemons()
        if (reaped.killed.length > 0) {
            process.stdout.write(`[mvp] reaped orphan vt-graphd daemons: ${JSON.stringify(reaped.killed)}\n`)
        }

        if (!args.keepArtifacts) {
            rmSync(projectRoot, { recursive: true, force: true })
            rmSync(appSupportPath, { recursive: true, force: true })
        } else {
            process.stdout.write(`[mvp] artifacts kept: project=${projectRoot} appSupport=${appSupportPath}\n`)
        }

        if (hostVmMetrics !== null) {
            try {
                hostVmMetricsSummary = await hostVmMetrics.stop()
                process.stdout.write('[mvp] saved devbox-vm metrics\n')
            } catch (e) {
                process.stderr.write(`[mvp] devbox-vm metrics save failed: ${(e as Error).message}\n`)
                failureReason ??= `devbox-vm metrics save failed: ${(e as Error).message}`
                pass = false
            }
        }
    }

    writeReportAndSummary({
        pass,
        failureReason,
        electronBootMs,
        mcpDiscoveryMs,
        agentCount: args.agentCount,
        nodesPerAgent: args.nodesPerAgent,
        agentsSucceeded,
        agentsTimedOut,
        agentWallMsP50,
        agentWallMsP99,
        agentWallMsMax,
        agentSpawnMsP50,
        agentSpawnMsP99,
        agentSpawnMsMax,
        nodesCreated,
        filesBefore,
        filesAfter,
        mcpPort,
        vaultDir,
        projectDir,
        appSupportPath,
        electronLogPath,
        perfRunDir: runContext.runDir,
        hostVmMetrics: hostVmMetricsSummary,
        outPath,
        totalWallMs: Date.now() - overallStart,
    })

    process.exit(pass ? 0 : 1)
}

void main().catch((err: unknown) => {
    process.stderr.write(`[mvp] fatal: ${(err as Error).message}\n`)
    if (err instanceof Error && err.stack) process.stderr.write(err.stack + '\n')
    process.exit(1)
})

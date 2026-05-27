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
import { createWriteStream, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { fileURLToPath } from 'node:url'
import { finished } from 'node:stream/promises'
import { inflateSync } from 'node:zlib'
import type { Page } from '@playwright/test'

import { killOrphanVtGraphdDaemons } from '@vt/graph-db-client'
import { generateVaultOnDisk } from '@vt/perf-fixtures'

import { launchElectronAndDiscoverMcp } from './launchElectron.ts'
import { runFakeAgent, buildMultiCreateNodeScript, type FakeAgentResult } from './runFakeAgent.ts'
import { countMarkdownFiles, writeReportAndSummary } from './report.ts'
import { computePerfRunDir, flushAndStopVtGraphd, forceStopVtGraphd } from './perfProfile.ts'
import { startHostVmMetricsSampler, type HostVmMetricsSummary, type HostVmMetricsSampler } from './hostVmMetrics.ts'
import {
    startMainProcessProfile,
    stopMainProcessProfileAndSave,
    type MainProcessCdpHandle,
} from '../_shared/main-process-cdp.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// measures/perf/e2e-storm-mvp -> measures/perf -> measures -> packages -> repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const AGENT_COUNT = 30
const NODES_PER_AGENT = 5
const EXPECTED_NODES_CREATED = AGENT_COUNT * NODES_PER_AGENT

interface Args {
    readonly keepArtifacts: boolean
    readonly mcpDiscoveryTimeoutMs: number
    readonly agentTimeoutMs: number
    readonly inspectPort: number
    readonly outPath: string | null
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
    metricsPath: string,
): Promise<() => Promise<void>> {
    mkdirSync(path.dirname(metricsPath), { recursive: true })
    const stream = createWriteStream(metricsPath, { flags: 'a' })
    let previousCpu = (await readMainProcessSnapshot(handle)).cpu
    let stopped = false

    const writeRow = async (): Promise<void> => {
        if (stopped) return
        const snapshot = await readMainProcessSnapshot(handle)
        const row = {
            t: Date.now(),
            svc: 'electron-main',
            cpu_user_ms: (snapshot.cpu.user - previousCpu.user) / 1000,
            cpu_sys_ms: (snapshot.cpu.system - previousCpu.system) / 1000,
            rss: snapshot.memory.rss,
            heap_used: snapshot.memory.heapUsed,
            heap_total: snapshot.memory.heapTotal,
            external: snapshot.memory.external,
            array_buffers: snapshot.memory.arrayBuffers,
        }
        previousCpu = snapshot.cpu
        stream.write(`${JSON.stringify(row)}\n`)
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
        stream.end()
        await finished(stream)
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

type RendererScreenshotCapture = {
    readonly dir: string
    readonly stop: () => Promise<void>
}

function rendererMetricValue(metrics: readonly RendererMetric[], name: string): number | undefined {
    return metrics.find(metric => metric.name === name)?.value
}

function pngLooksNonBlank(buffer: Buffer): boolean {
    if (buffer.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0) return false
    let offset = 8
    let width = 0
    let height = 0
    let colorType = 0
    const idat: Buffer[] = []

    while (offset + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(offset)
        const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
        const data = buffer.subarray(offset + 8, offset + 8 + length)
        offset += 12 + length

        if (type === 'IHDR') {
            width = data.readUInt32BE(0)
            height = data.readUInt32BE(4)
            const bitDepth = data[8]
            colorType = data[9] ?? 0
            if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) return false
        } else if (type === 'IDAT') {
            idat.push(data)
        } else if (type === 'IEND') {
            break
        }
    }

    const bytesPerPixel = colorType === 6 ? 4 : 3
    const rowBytes = width * bytesPerPixel
    const inflated = inflateSync(Buffer.concat(idat))
    let read = 0
    let previous = Buffer.alloc(rowBytes)
    let darkest = 255
    let brightest = 0
    let sampled = 0

    for (let y = 0; y < height; y++) {
        const filter = inflated[read++] ?? 0
        const row = Buffer.from(inflated.subarray(read, read + rowBytes))
        read += rowBytes

        for (let x = 0; x < rowBytes; x++) {
            const left = x >= bytesPerPixel ? row[x - bytesPerPixel] ?? 0 : 0
            const up = previous[x] ?? 0
            const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] ?? 0 : 0
            const paeth = (() => {
                const p = left + up - upLeft
                const pa = Math.abs(p - left)
                const pb = Math.abs(p - up)
                const pc = Math.abs(p - upLeft)
                return pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
            })()
            const predictor =
                filter === 1 ? left
                    : filter === 2 ? up
                        : filter === 3 ? Math.floor((left + up) / 2)
                            : filter === 4 ? paeth
                                : 0
            row[x] = (row[x]! + predictor) & 0xff
        }

        const stride = Math.max(1, Math.floor(width / 32))
        for (let x = 0; x < width; x += stride) {
            const i = x * bytesPerPixel
            const luminance = Math.round(((row[i] ?? 0) * 0.2126) + ((row[i + 1] ?? 0) * 0.7152) + ((row[i + 2] ?? 0) * 0.0722))
            darkest = Math.min(darkest, luminance)
            brightest = Math.max(brightest, luminance)
            sampled += 1
        }
        previous = row
    }

    return sampled > 0 && brightest > 20 && (brightest - darkest) > 10
}

async function startRendererProfileCapture(
    appWindow: Page,
    runDir: string,
): Promise<RendererProfileCapture> {
    const cdp = await appWindow.context().newCDPSession(appWindow) as RendererCdpHandle
    const metricsPath = path.join(runDir, 'metrics', 'renderer.metrics.ndjson')
    const profilesDir = path.join(runDir, 'profiles')
    mkdirSync(path.dirname(metricsPath), { recursive: true })
    mkdirSync(profilesDir, { recursive: true })
    const stream = createWriteStream(metricsPath, { flags: 'a' })
    let stopped = false

    await cdp.send('Performance.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.start')

    const writeRow = async (): Promise<void> => {
        if (stopped) return
        const response = await cdp.send('Performance.getMetrics') as { readonly metrics?: readonly RendererMetric[] }
        const metrics = response.metrics ?? []
        const row = {
            t: Date.now(),
            svc: 'renderer',
            js_heap_used: rendererMetricValue(metrics, 'JSHeapUsedSize') ?? 0,
            js_heap_total: rendererMetricValue(metrics, 'JSHeapTotalSize') ?? 0,
            nodes: rendererMetricValue(metrics, 'Nodes') ?? 0,
            documents: rendererMetricValue(metrics, 'Documents') ?? 0,
            layout_count: rendererMetricValue(metrics, 'LayoutCount') ?? 0,
            recalc_style_count: rendererMetricValue(metrics, 'RecalcStyleCount') ?? 0,
            layout_duration_ms: (rendererMetricValue(metrics, 'LayoutDuration') ?? 0) * 1000,
            recalc_style_duration_ms: (rendererMetricValue(metrics, 'RecalcStyleDuration') ?? 0) * 1000,
            script_duration_ms: (rendererMetricValue(metrics, 'ScriptDuration') ?? 0) * 1000,
            task_duration_ms: (rendererMetricValue(metrics, 'TaskDuration') ?? 0) * 1000,
        }
        stream.write(`${JSON.stringify(row)}\n`)
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
            stream.end()
            await finished(stream)
            if (!response.profile) throw new Error('Renderer Profiler.stop returned no profile')
            writeFileSync(path.join(profilesDir, 'renderer.cpuprofile'), JSON.stringify(response.profile), 'utf8')
        },
    }
}

async function startRendererScreenshotCapture(
    appWindow: Page,
    runDir: string,
    intervalMs: number = 20_000,
): Promise<RendererScreenshotCapture> {
    const dir = path.join(runDir, 'screenshots')
    mkdirSync(dir, { recursive: true })
    let stopped = false
    let inFlight = false
    let index = 0

    const capture = async (reason: 'sample' | 'final'): Promise<void> => {
        if (inFlight) return
        inFlight = true
        const paddedIndex = String(index++).padStart(3, '0')
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const screenshotPath = path.join(dir, `renderer-${paddedIndex}-${reason}-${timestamp}.png`)
        try {
            const bytes = await appWindow.screenshot({ path: screenshotPath, timeout: 5_000 })
            if (!pngLooksNonBlank(Buffer.from(bytes))) throw new Error(`blank renderer screenshot: ${screenshotPath}`)
            process.stdout.write(`[mvp] screenshot: ${screenshotPath}\n`)
        } finally {
            inFlight = false
        }
    }

    void capture('sample').catch((error: unknown) => {
        process.stderr.write(`[mvp] initial renderer screenshot failed: ${(error as Error).message}\n`)
    })
    const interval = setInterval(() => {
        if (stopped) return
        void capture('sample').catch((error: unknown) => {
            process.stderr.write(`[mvp] renderer screenshot failed: ${(error as Error).message}\n`)
        })
    }, intervalMs)
    interval.unref()

    return {
        dir,
        stop: async () => {
            if (stopped) return
            stopped = true
            clearInterval(interval)
            await capture('final').catch((error: unknown) => {
                process.stderr.write(`[mvp] final renderer screenshot failed: ${(error as Error).message}\n`)
            })
        },
    }
}

function parseArgs(argv: readonly string[]): Args {
    let keepArtifacts = false
    let mcpDiscoveryTimeoutMs = 120_000
    let agentTimeoutMs = 60_000
    let inspectPort = 9244
    let outPath: string | null = null

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
            case '--help':
            case '-h':
                process.stdout.write(
                    'e2e-storm-mvp: prove headful-Electron + daemon + MCP + fake-agent end-to-end.\n'
                    + '  --mcp-discovery-timeout-ms MS   default 120000\n'
                    + '  --agent-timeout-ms MS           default 60000\n'
                    + '  --inspect-port N                default 9244\n'
                    + '  --keep-artifacts                keep temp dirs after the run\n'
                    + '  --out PATH                      report path (default ~/.voicetree/reports/perf-e2e-mvp-<ts>.json)\n',
                )
                process.exit(0)
            default:
                throw new Error(`unknown argument: ${a}`)
        }
    }

    return { keepArtifacts, mcpDiscoveryTimeoutMs, agentTimeoutMs, inspectPort, outPath }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2))

    const overallStart = Date.now()
    const projectRoot = mkdtempSync(path.join(os.tmpdir(), 'vt-e2e-mvp-project-'))
    const projectDir = path.join(projectRoot, 'mvp-project')
    const vaultDir = path.join(projectDir, 'mvp-vault')
    mkdirSync(vaultDir, { recursive: true })

    const appSupportPath = mkdtempSync(path.join(os.tmpdir(), 'vt-e2e-mvp-app-'))

    const reportsDir = path.join(os.homedir(), '.voicetree', 'reports')
    mkdirSync(reportsDir, { recursive: true })
    const ts = new Date().toISOString().replace(/[:.]/g, '-')
    const outPath = args.outPath ?? path.join(reportsDir, `perf-e2e-mvp-${ts}.json`)
    const electronLogPath = path.join(reportsDir, `perf-e2e-mvp-electron-${ts}.log`)

    // Bob's perf-dashboard producer lands artifacts in a per-run subdir of
    // ~/.voicetree/reports/. The dashboard's listRuns filter requires the
    // directory name to start with `stable-perf-`. Pre-creating the dir +
    // env-pinning it means every spawned process (electron-main, vt-graphd,
    // any future probed service) writes to the same run dir under a single
    // dashboard entry.
    const perfProfile = computePerfRunDir(reportsDir, ts)
    mkdirSync(perfProfile.runDir, { recursive: true })
    process.stdout.write(`[mvp] perf run dir: ${perfProfile.runDir}\n`)

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
    let rendererScreenshots: RendererScreenshotCapture | null = null
    let hostVmMetrics: HostVmMetricsSampler | null = null
    let hostVmMetricsSummary: HostVmMetricsSummary | null = null

    try {
        hostVmMetrics = await startHostVmMetricsSampler(
            path.join(perfProfile.runDir, 'metrics', 'devbox-vm.metrics.ndjson'),
        )
        process.stdout.write(`[mvp] started devbox-vm metrics sampler: ${hostVmMetrics.metricsPath}\n`)

        const launched = await launchElectronAndDiscoverMcp({
            repoRoot: REPO_ROOT,
            projectDir,
            vaultDir,
            appSupportPath,
            logFilePath: electronLogPath,
            inspectPort: args.inspectPort,
            mcpDiscoveryTimeoutMs: args.mcpDiscoveryTimeoutMs,
            extraEnv: perfProfile.env,
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
            path.join(perfProfile.runDir, 'metrics', 'electron-main.metrics.ndjson'),
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
        rendererProfile = await startRendererProfileCapture(appWindow, perfProfile.runDir)
        process.stdout.write('[mvp] started renderer CDP profile + metrics sampler\n')
        rendererScreenshots = await startRendererScreenshotCapture(appWindow, perfProfile.runDir)
        process.stdout.write(`[mvp] started renderer screenshot sampler: ${rendererScreenshots.dir}\n`)

        const agentResults = await Promise.all(Array.from({ length: AGENT_COUNT }, (_, agentIndex) => (
            runFakeAgent({
                appWindow,
                repoRoot: REPO_ROOT,
                vaultDir,
                mcpPort,
                seedNodeAbsolutePath,
                terminalId: `e2e-mvp-agent-${agentIndex}`,
                script: buildMultiCreateNodeScript(agentIndex, NODES_PER_AGENT),
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
        } else if (nodesCreated !== EXPECTED_NODES_CREATED) {
            failureReason = `expected ${EXPECTED_NODES_CREATED} new markdown files, got ${nodesCreated} (before=${filesBefore}, after=${filesAfter})`
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
            if (rendererScreenshots !== null) {
                try {
                    await rendererScreenshots.stop()
                    process.stdout.write(`[mvp] saved renderer screenshots: ${rendererScreenshots.dir}\n`)
                    rendererScreenshots = null
                } catch (e) {
                    process.stderr.write(`[mvp] renderer screenshot save failed: ${(e as Error).message}\n`)
                }
            }

            if (rendererProfile !== null) {
                try {
                    await rendererProfile.stop()
                    rendererProfile = null
                    process.stdout.write('[mvp] saved renderer CDP profile + metrics\n')
                } catch (e) {
                    process.stderr.write(`[mvp] renderer profile save failed: ${(e as Error).message}\n`)
                }
            }

            if (electronMainProfile !== null) {
                try {
                    await stopElectronMainMetrics?.()
                    stopElectronMainMetrics = null
                    await stopMainProcessProfileAndSave(
                        electronMainProfile,
                        path.join(perfProfile.runDir, 'profiles'),
                        'electron-main.cpuprofile',
                    )
                    electronMainProfile = null
                    process.stdout.write('[mvp] saved electron-main CDP profile + metrics\n')
                } catch (e) {
                    process.stderr.write(`[mvp] electron-main profile save failed: ${(e as Error).message}\n`)
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
            }
        }
    }

    writeReportAndSummary({
        pass,
        failureReason,
        electronBootMs,
        mcpDiscoveryMs,
        agentCount: AGENT_COUNT,
        nodesPerAgent: NODES_PER_AGENT,
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
        perfRunDir: perfProfile.runDir,
        screenshotDir: path.join(perfProfile.runDir, 'screenshots'),
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

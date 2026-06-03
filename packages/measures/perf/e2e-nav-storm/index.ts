/**
 * e2e-nav-storm orchestrator.
 *
 * Turns perf testing from "daemon write throughput" into "renderer frame
 * latency while navigating a large, growing graph" — the real user-facing
 * problem. It:
 *   1. SEEDS a large realistic project (generateProjectOnDisk, default N≈1000).
 *   2. Launches the real headful Electron app and waits for the graph to load.
 *   3. Opens a measured nav window: drives REAL pan/zoom/select/expand/fit
 *      gestures (navDriver) while a background trickle writer grows the graph
 *      through the daemon's folder watcher (trickleWriter).
 *   4. Captures the frontend MELTs via the renderer perf probe (frame/longtask/
 *      INP/interaction spans + GPU-process CPU from main) → OTLP, plus a renderer
 *      cpuprofile → Pyroscope and non-blank screenshots.
 *   5. Validates the signals actually landed and reports the first frame numbers.
 *
 * This is the MEASUREMENT TOOL, not a perf fix — it does not optimise rendering.
 *
 * Run (headful, with the perf stack up):
 *   VOICETREE_OTLP_ENDPOINT=localhost:2994 \
 *     node --import tsx packages/measures/perf/e2e-nav-storm/index.ts --nodes 1000
 *
 * Exit code: 0 on pass, 1 on fail.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

import { killOrphanVtGraphdDaemons } from '@vt/graph-db-client'
import { generateProjectOnDisk, type ProjectLayout } from '@vt/perf-fixtures'
import { shutdownTmuxServer } from '@vt/vt-daemon/agent-runtime/terminals/tmux/tmux-server.ts'

import { launchElectronHeadful } from './launchElectronHeadful.ts'
import { flushAndStopVtGraphd, forceStopVtGraphd } from '../e2e-storm-mvp/perfProfile.ts'
import { resolveRunContext } from './runContext.ts'
import { driveNavLoop } from './navDriver.ts'
import { startTrickleWriter } from './trickleWriter.ts'
import { startRendererCpuProfile, startScreenshots } from './rendererCaptures.ts'
import { writeNavReportAndSummary } from './report.ts'
import type { ProbeSnapshot } from '../../../../webapp/src/shell/perf/rendererPerfProbe.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
// measures/perf/e2e-nav-storm -> measures/perf -> measures -> packages -> repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

interface Args {
    readonly nodes: number
    readonly navWindowMs: number
    readonly actionIntervalMs: number
    readonly writeIntervalMs: number
    readonly inspectPort: number
    readonly keepArtifacts: boolean
    readonly outPath: string | null
}

function parseArgs(argv: readonly string[]): Args {
    let nodes = 1000
    let navWindowMs = 90_000
    let actionIntervalMs = 300
    let writeIntervalMs = 30_000
    let inspectPort = 9245
    let keepArtifacts = false
    let outPath: string | null = null

    const intArg = (raw: string | undefined, name: string): number => {
        const n = Number.parseInt(raw ?? '', 10)
        if (!Number.isInteger(n) || n < 0) throw new Error(`bad --${name}: ${raw}`)
        return n
    }
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        switch (a) {
            case '--nodes': nodes = intArg(argv[++i], 'nodes'); break
            case '--nav-window-ms': navWindowMs = intArg(argv[++i], 'nav-window-ms'); break
            case '--action-interval-ms': actionIntervalMs = intArg(argv[++i], 'action-interval-ms'); break
            case '--write-interval-ms': writeIntervalMs = intArg(argv[++i], 'write-interval-ms'); break
            case '--inspect-port': inspectPort = intArg(argv[++i], 'inspect-port'); break
            case '--keep-artifacts': keepArtifacts = true; break
            case '--out': outPath = argv[++i] ?? null; break
            case '--help': case '-h':
                process.stdout.write(
                    'e2e-nav-storm: renderer frame latency while navigating a large growing graph.\n'
                    + '  --nodes N               seed node count (default 1000)\n'
                    + '  --nav-window-ms MS      measured nav window (default 90000)\n'
                    + '  --action-interval-ms MS gesture cadence (default 300)\n'
                    + '  --write-interval-ms MS  trickle write cadence (default 30000)\n'
                    + '  --inspect-port N        electron --inspect port (default 9245)\n'
                    + '  --keep-artifacts        keep temp project + home after the run\n'
                    + '  --out PATH              report path (default <runDir>/e2e-nav-storm-report.json)\n',
                )
                process.exit(0)
                break
            default: throw new Error(`unknown argument: ${a}`)
        }
    }
    return { nodes, navWindowMs, actionIntervalMs, writeIntervalMs, inspectPort, keepArtifacts, outPath }
}

function writeMinimalSettings(voicetreeHomePath: string): void {
    writeFileSync(
        path.join(voicetreeHomePath, 'settings.json'),
        JSON.stringify({
            agents: [{ name: 'Idle', command: 'sleep 1' }],
            defaultAgent: 'Idle',
            terminalSpawnPathRelativeToWatchedDirectory: '/',
            INJECT_ENV_VARS: { AGENT_PROMPT: '' },
        }, null, 2),
        'utf8',
    )
}

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Open the project via the real mainAPI path once hostAPI is exposed. */
async function openSeededProject(
    appWindow: import('@playwright/test').Page,
    projectDir: string,
): Promise<void> {
    await appWindow.waitForFunction(
        () => Boolean((window as unknown as { hostAPI?: { main?: { openProject?: unknown } } }).hostAPI?.main?.openProject),
        undefined,
        { timeout: 30_000 },
    )
    const result = await appWindow.evaluate(async (dir) => {
        try {
            await (window as unknown as { hostAPI: { main: { openProject: (d: string) => Promise<unknown> } } }).hostAPI.main.openProject(dir)
            return 'ok'
        } catch (e) { return `err:${(e as Error).message}` }
    }, projectDir)
    if (result !== 'ok') throw new Error(`openProject failed: ${result}`)
}

/** Poll until the renderer's cytoscape node count stabilises at/above target. */
async function waitForGraphLoaded(
    appWindow: import('@playwright/test').Page,
    minNodes: number,
    timeoutMs: number,
): Promise<number> {
    const deadline = Date.now() + timeoutMs
    let lastCount = -1
    let stableSamples = 0
    while (Date.now() < deadline) {
        const count = await appWindow.evaluate(() => window.cytoscapeInstance?.nodes().length ?? 0)
        if (count >= minNodes && count === lastCount) {
            stableSamples += 1
            if (stableSamples >= 3) return count
        } else {
            stableSamples = 0
        }
        lastCount = count
        await sleep(1000)
    }
    return lastCount
}

async function probeCall<T>(appWindow: import('@playwright/test').Page, method: 'beginWindow' | 'endWindow' | 'snapshot' | 'stop'): Promise<T> {
    return appWindow.evaluate((m) => {
        const probe = window.__vtPerfProbe__ as unknown as Record<string, () => unknown> | undefined
        if (!probe) throw new Error('window.__vtPerfProbe__ unavailable — perf probe did not start (VOICETREE_PERF_PROBE / build?)')
        return probe[m]?.() as T
    }, method)
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2))
    const runContext = resolveRunContext()
    const overallStart = Date.now()

    const projectRoot = mkdtempSync(path.join(tmpdir(), 'vt-nav-storm-project-'))
    const projectDir = path.join(projectRoot, 'nav-storm-project')
    mkdirSync(projectDir, { recursive: true })
    const voicetreeHomePath = mkdtempSync(path.join(tmpdir(), 'vt-nav-storm-home-'))
    writeMinimalSettings(voicetreeHomePath)

    const logsDir = path.join(runContext.runDir, 'logs')
    mkdirSync(logsDir, { recursive: true })
    const outPath = args.outPath ?? path.join(runContext.runDir, 'e2e-nav-storm-report.json')
    process.stdout.write(`[nav-storm] run id: ${runContext.runUuid}\n`)
    process.stdout.write(`[nav-storm] perf run dir: ${runContext.runDir}\n`)
    process.stdout.write(`[nav-storm] otlp endpoint: ${runContext.otlpEndpoint ?? '(none — metrics will be inert)'}\n`)

    const layout: ProjectLayout = generateProjectOnDisk(projectDir, args.nodes)
    process.stdout.write(`[nav-storm] seeded ${layout.nodes.length} nodes at ${projectDir}\n`)

    let pass = false
    let failureReason: string | null = null
    let app: Awaited<ReturnType<typeof launchElectronHeadful>>['app'] | null = null
    let snapshot: ProbeSnapshot | null = null
    let navResult: Awaited<ReturnType<typeof driveNavLoop>> | null = null
    let trickleResult = { nodesWritten: 0, paths: [] as readonly string[] }
    let screenshotResult = { count: 0, nonBlank: 0 }
    let cpuProfileResult: { cpuprofilePath: string; pyroscopeQuery: string; topFrames: import('../_shared/main-process-cdp.ts').MainProcessMetrics['topFunctions'] } = { cpuprofilePath: '', pyroscopeQuery: '', topFrames: [] }
    let loadedNodeCount = 0

    try {
        const launched = await launchElectronHeadful({
            repoRoot: REPO_ROOT,
            projectDir,
            voicetreeHomePath,
            logFilePath: path.join(logsDir, 'vt-electron-main.log'),
            inspectPort: args.inspectPort,
            extraEnv: runContext.perfEnv,
        })
        app = launched.app
        process.stdout.write(`[nav-storm] electron booted (${launched.bootMs}ms)\n`)

        const appWindow = await app.firstWindow({ timeout: 30_000 })
        appWindow.on('pageerror', e => process.stderr.write(`[nav-storm] page error: ${e.message}\n`))
        await appWindow.waitForLoadState('domcontentloaded')

        // Open the seeded project through the real path: this honours the saved
        // writeFolderPath (=projectDir) and loads ALL .md, spawning the daemon.
        // (`--open-folder` would instead create a dated write-subfolder that
        // projects only itself — see launchElectronHeadful.)
        await openSeededProject(appWindow, projectDir)
        process.stdout.write('[nav-storm] opened project (full .md load)\n')

        loadedNodeCount = await waitForGraphLoaded(appWindow, Math.floor(layout.nodes.length * 0.8), 180_000)
        process.stdout.write(`[nav-storm] graph loaded: ${loadedNodeCount} cytoscape nodes\n`)
        if (loadedNodeCount < Math.floor(layout.nodes.length * 0.8)) {
            throw new Error(`graph did not load: ${loadedNodeCount} nodes (< 80% of ${layout.nodes.length})`)
        }

        // Open the measured window AFTER the seed load so the snapshot reflects
        // nav, not the initial layout burst.
        await probeCall(appWindow, 'beginWindow')
        const cpuProfile = await startRendererCpuProfile(appWindow, runContext.runUuid, runContext.runDir)
        const screenshots = await startScreenshots(appWindow, runContext.runDir)
        const trickle = startTrickleWriter({
            projectDir,
            intervalMs: args.writeIntervalMs,
            linkTargetRelativePath: layout.firstClusterNodePaths[0] ?? layout.nodes[0]!.relativePath,
        })
        process.stdout.write(`[nav-storm] measured nav window: ${(args.navWindowMs / 1000).toFixed(0)}s\n`)

        navResult = await driveNavLoop({ appWindow, durationMs: args.navWindowMs, actionIntervalMs: args.actionIntervalMs })
        process.stdout.write(`[nav-storm] nav loop done: ${navResult.totalActions} actions, skipped=${JSON.stringify(navResult.skippedKinds)}\n`)

        await probeCall(appWindow, 'endWindow')
        snapshot = await probeCall<ProbeSnapshot>(appWindow, 'snapshot')
        trickleResult = trickle.stop()
        screenshotResult = await screenshots.stop()
        cpuProfileResult = await cpuProfile.stop()
        process.stdout.write(`[nav-storm] renderer cpuprofile → ${cpuProfileResult.pyroscopeQuery}\n`)

        // Force the probe's final batch to main, then let the OTLP readers ship
        // it (PeriodicExportingMetricReader=1s, BatchSpanProcessor) before we
        // tear electron down.
        await probeCall(appWindow, 'stop')
        await sleep(5000)

        // ---- validation bar (anti-reward-hack: all must hold) ----
        const reasons: string[] = []
        if (loadedNodeCount < Math.floor(layout.nodes.length * 0.8)) reasons.push(`only ${loadedNodeCount} nodes loaded`)
        if (navResult.totalActions === 0) reasons.push('nav drove zero actions')
        if (snapshot.frames.count === 0) reasons.push('frame.duration_ms has no samples')
        if (snapshot.inp.count === 0) reasons.push('no interaction latency samples (INP)')
        if (trickleResult.nodesWritten === 0) reasons.push('no trickle nodes written')
        if (snapshot.nodes.addedDuringWindow === 0) reasons.push('trickle writes not observed as node-added in renderer')
        if (screenshotResult.nonBlank === 0) reasons.push('no non-blank screenshots (graph never rendered)')
        if (reasons.length === 0) pass = true
        else failureReason = reasons.join('; ')
    } catch (err) {
        failureReason = (err as Error).message
        if ((err as Error).stack) process.stderr.write(`[nav-storm] ${(err as Error).stack}\n`)
    } finally {
        await flushAndStopVtGraphd(projectDir, 4000).catch(() => undefined)
        if (app) {
            const pid = app.process().pid
            process.stdout.write(`[nav-storm] terminating electron pid=${pid}\n`)
            if (pid !== undefined) { try { process.kill(pid, 'SIGKILL') } catch { /* gone */ } }
        }
        await forceStopVtGraphd(projectDir, 2000).catch(() => undefined)
        await shutdownTmuxServer({ voicetreeHomePath }).catch(() => undefined)
        const reaped = killOrphanVtGraphdDaemons()
        if (reaped.killed.length > 0) process.stdout.write(`[nav-storm] reaped orphan daemons: ${JSON.stringify(reaped.killed)}\n`)
        if (!args.keepArtifacts) {
            rmSync(projectRoot, { recursive: true, force: true })
            rmSync(voicetreeHomePath, { recursive: true, force: true })
        } else {
            process.stdout.write(`[nav-storm] artifacts kept: project=${projectRoot} home=${voicetreeHomePath}\n`)
        }
    }

    const emptySnapshot: ProbeSnapshot = {
        windowMs: 0,
        frames: { count: 0, p50: 0, p95: 0, p99: 0, max: 0, droppedFraction: 0, jankFraction: 0 },
        longtask: { count: 0, p50: 0, p99: 0, maxMs: 0, totalMs: 0 },
        inp: { count: 0, p50: 0, p95: 0, p99: 0 },
        nodes: { total: 0, visible: 0, addedDuringWindow: 0 },
    }
    const finalSnapshot = snapshot ?? emptySnapshot
    writeNavReportAndSummary({
        pass,
        failureReason,
        runUuid: runContext.runUuid,
        otlpEndpoint: runContext.otlpEndpoint ?? null,
        seedNodeCount: layout.nodes.length,
        loadedNodeCount,
        nav: navResult ?? { totalActions: 0, actionsByKind: { pan: 0, zoom: 0, select: 0, expand: 0, fit: 0 }, skippedKinds: [] },
        trickle: { nodesWritten: trickleResult.nodesWritten, observedAddedInRenderer: finalSnapshot.nodes.addedDuringWindow },
        screenshots: screenshotResult,
        probe: finalSnapshot,
        topRendererFrames: cpuProfileResult.topFrames,
        rendererCpuprofilePath: cpuProfileResult.cpuprofilePath,
        pyroscopeQuery: cpuProfileResult.pyroscopeQuery,
        perfRunDir: runContext.runDir,
        outPath,
        totalWallMs: Date.now() - overallStart,
    })

    process.exit(pass ? 0 : 1)
}

void main().catch((err: unknown) => {
    process.stderr.write(`[nav-storm] fatal: ${(err as Error).message}\n`)
    if (err instanceof Error && err.stack) process.stderr.write(err.stack + '\n')
    process.exit(1)
})

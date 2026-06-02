/**
 * e2e-storm-mvp orchestrator.
 *
 * Minimal end-to-end perf-architecture smoke: launches the real Electron
 * VoiceTree main bundle, lets it boot the daemon against a freshly seeded
 * project, discovers the daemon's `/rpc` endpoint via `<project>/.voicetree/`
 * (rpc.port + auth-token), spawns fake-agents that each create N nodes via the
 * daemon's `spawn_agent` tool, then asserts the expected markdown files landed
 * on disk.
 *
 * The harness captures one process at a time. vt-graphd uses the in-process
 * perf probe; Electron main is captured externally through its Node inspector
 * port so production Electron source stays out of the measurement contract.
 *
 * Stats, run-config, and process-observation machinery live in sibling
 * modules (stormStats / runConfig / captures); this file owns only the
 * orchestration + lifecycle.
 *
 * Run:
 *   node --import tsx packages/measures/perf/e2e-storm-mvp/index.ts
 *
 * Exit code: 0 on pass, 1 on fail.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import * as path from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import type { Page } from '@playwright/test'
import type { DaemonRpcClient } from '@vt/vt-rpc'

import { killOrphanVtGraphdDaemons } from '@vt/graph-db-client'
import { generateProjectOnDisk } from '@vt/perf-fixtures'
import { shutdownTmuxServer } from '@vt/vt-daemon/agent-runtime/terminals/tmux/tmux-server.ts'

import { launchElectronAndDiscoverDaemon } from './launchElectron.ts'
import {
    promptTemplateName,
    runFakeAgent,
    waitForAgentListed,
    waitForInteractiveTerminalMounted,
} from './runFakeAgent.ts'
import { countMarkdownFiles, writeReportAndSummary } from './report.ts'
import { flushAndStopVtGraphd, forceStopVtGraphd } from './perfProfile.ts'
import { startHostVmMetricsSampler, type HostVmMetricsSummary, type HostVmMetricsSampler } from './hostVmMetrics.ts'
import { uploadV8CpuProfileToPyroscope } from './pyroscopeProfile.ts'
import {
    startMainProcessProfile,
    stopMainProcessProfileAndSave,
    type MainProcessCdpHandle,
} from '../_shared/main-process-cdp.ts'
import {
    startMainProcessMetricsSampler,
    startRendererProfileCapture,
    startRendererScreenshotCapture,
    type RendererProfileCapture,
    type RendererScreenshotCapture,
} from './captures.ts'
import { countStormOutputNodes, spawnTimeStats, wallTimeStats } from './stormStats.ts'
import { parseArgs, resolveRunContext, writeStormSettings, STORM_CALLER_COMMAND } from './runConfig.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// measures/perf/e2e-storm-mvp -> measures/perf -> measures -> packages -> repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

async function spawnCallerTerminal(
    appWindow: Page,
    seedNodeAbsolutePath: string,
): Promise<string> {
    const result = await appWindow.evaluate(async ({ nodeId, command, repoRoot }) => {
        const api = (window as unknown as {
            hostAPI?: {
                main?: {
                    spawnTerminalWithContextNode?: (
                        request: {
                            taskNodeId: string
                            agentCommand?: string
                            terminalCount?: number
                            skipFitAnimation?: boolean
                            startUnpinned?: boolean
                            spawnDirectory?: string
                        },
                    ) => Promise<{ terminalId: string; contextNodeId: string }>
                }
            }
        }).hostAPI?.main
        if (!api?.spawnTerminalWithContextNode) {
            throw new Error('window.hostAPI.main.spawnTerminalWithContextNode unavailable')
        }
        return api.spawnTerminalWithContextNode({
            taskNodeId: nodeId,
            agentCommand: command,
            terminalCount: 0,
            skipFitAnimation: true,
            startUnpinned: true,
            spawnDirectory: repoRoot,
        })
    }, { nodeId: seedNodeAbsolutePath, command: STORM_CALLER_COMMAND, repoRoot: REPO_ROOT })
    return result.terminalId
}

/**
 * Wait until the Electron main process has finished opening the project and
 * bound its per-project vt-daemon. Discovery's rpc.port + list_agents probe can
 * win a small race against `openProject` → `bindVtDaemonForProject` in main —
 * the daemon serves the test process directly a beat before main caches its
 * active binding, so a `spawnTerminalWithContextNode` IPC (which reads that
 * binding) would throw `no active vt-daemon binding`. `getWatchStatus` flips to
 * `isWatching` only after the bind completes, so it is the readiness signal.
 */
async function waitForProjectOpened(appWindow: Page, projectDir: string, timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs
    let lastStatus = 'null'
    while (Date.now() < deadline) {
        const status = await appWindow.evaluate(async () => {
            const api = (window as unknown as {
                hostAPI?: { main?: { getWatchStatus?: () => Promise<{ isWatching: boolean; directory?: string }> } }
            }).hostAPI?.main
            return (await api?.getWatchStatus?.()) ?? null
        })
        lastStatus = JSON.stringify(status)
        if (status?.isWatching && status.directory && path.resolve(status.directory) === path.resolve(projectDir)) {
            return
        }
        await new Promise(r => setTimeout(r, 200))
    }
    throw new Error(`project ${projectDir} not opened/bound within ${timeoutMs}ms (last watch status: ${lastStatus})`)
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2))
    const runContext = resolveRunContext()

    const overallStart = Date.now()
    const projectRoot = mkdtempSync(path.join(tmpdir(), 'vt-e2e-mvp-project-'))
    const projectDir = path.join(projectRoot, 'mvp-project')
    mkdirSync(projectDir, { recursive: true })

    const voicetreeHomePath = mkdtempSync(path.join(tmpdir(), 'vt-e2e-mvp-app-'))
    writeStormSettings(voicetreeHomePath, args, REPO_ROOT)
    const logsDir = path.join(runContext.runDir, 'logs')
    mkdirSync(logsDir, { recursive: true })
    const outPath = args.outPath ?? path.join(runContext.runDir, 'e2e-storm-mvp-report.json')
    const electronLogPath = path.join(logsDir, 'vt-electron-main.log')
    process.stdout.write(`[mvp] run id: ${runContext.runUuid}\n`)
    process.stdout.write(`[mvp] perf run dir: ${runContext.runDir}\n`)

    // Seed a small realistic project so the daemon has nodes to attach to. The
    // single-agent MVP doesn't dogpile, but we still want the seed project to
    // exercise the daemon's full project-scan + index-build path.
    const projectLayout = generateProjectOnDisk(projectDir, 5)
    process.stdout.write(`[mvp] seeded project: ${projectLayout.nodes.length} nodes at ${projectDir}\n`)

    const filesBefore = countMarkdownFiles(projectDir)

    let pass = false
    let failureReason: string | null = null
    let daemonClient: DaemonRpcClient | null = null
    let electronBootMs = 0
    let daemonDiscoveryMs = 0
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
    let app: Awaited<ReturnType<typeof launchElectronAndDiscoverDaemon>>['app'] | null = null
    let electronMainProfile: MainProcessCdpHandle | null = null
    let stopElectronMainMetrics: (() => Promise<void>) | null = null
    let rendererProfile: RendererProfileCapture | null = null
    let rendererScreenshots: RendererScreenshotCapture | null = null
    let hostVmMetrics: HostVmMetricsSampler | null = null
    let hostVmMetricsSummary: HostVmMetricsSummary | null = null

    try {
        try {
            hostVmMetrics = await startHostVmMetricsSampler({
                otlpEndpoint: runContext.otlpEndpoint,
                instanceId: runContext.runUuid,
            })
            process.stdout.write('[mvp] started devbox-vm OTEL metrics sampler\n')
        } catch (error) {
            process.stderr.write(`[mvp] devbox-vm metrics sampler disabled: ${(error as Error).message}\n`)
        }

        const launched = await launchElectronAndDiscoverDaemon({
            repoRoot: REPO_ROOT,
            projectDir,
            voicetreeHomePath,
            logFilePath: electronLogPath,
            inspectPort: args.inspectPort,
            daemonDiscoveryTimeoutMs: args.daemonDiscoveryTimeoutMs,
            extraEnv: runContext.perfEnv,
        })
        app = launched.app
        const client = launched.daemonClient
        daemonClient = client
        electronBootMs = launched.bootMs
        daemonDiscoveryMs = launched.daemonDiscoveryMs
        process.stdout.write(
            `[mvp] electron booted (${electronBootMs}ms), daemon ${client.endpoint.url} `
            + `(discovered in ${daemonDiscoveryMs}ms)\n`,
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
            projectDir,
            projectLayout.firstClusterNodePaths[0] ?? projectLayout.nodes[0].relativePath,
        )

        const appWindow = await app.firstWindow({ timeout: 30_000 })
        appWindow.on('pageerror', (e) => process.stderr.write(`[mvp] page error: ${e.message}\n`))
        await appWindow.waitForLoadState('domcontentloaded')
        await waitForProjectOpened(appWindow, projectDir, 60_000)
        process.stdout.write('[mvp] project opened + vt-daemon bound in main\n')

        const callerTerminalId = await spawnCallerTerminal(appWindow, seedNodeAbsolutePath)
        process.stdout.write(`[mvp] spawned real caller terminal: ${callerTerminalId}\n`)
        if (!await waitForAgentListed(client, callerTerminalId, 10_000)) {
            throw new Error(`caller terminal ${callerTerminalId} did not appear in list_agents`)
        }
        process.stdout.write(`[mvp] caller terminal visible to daemon: ${callerTerminalId}\n`)
        if (!await waitForInteractiveTerminalMounted(appWindow, callerTerminalId, 10_000)) {
            throw new Error(`caller terminal ${callerTerminalId} did not mount a headful xterm floating window`)
        }
        process.stdout.write(`[mvp] caller terminal mounted in renderer: ${callerTerminalId}\n`)

        rendererProfile = await startRendererProfileCapture(appWindow, runContext)
        process.stdout.write('[mvp] started renderer CDP profile + metrics sampler\n')
        rendererScreenshots = await startRendererScreenshotCapture(appWindow, runContext.runDir)
        process.stdout.write(`[mvp] started renderer screenshot sampler: ${rendererScreenshots.dir}\n`)

        const agentResults = await Promise.all(Array.from({ length: args.agentCount }, (_, agentIndex) => (
            runFakeAgent({
                appWindow,
                repoRoot: REPO_ROOT,
                daemonClient: client,
                seedNodeAbsolutePath,
                callerTerminalId,
                promptTemplate: promptTemplateName(agentIndex),
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
            if (result.terminalOutput) {
                process.stdout.write(`[mvp] agent ${agentIndex} terminal output:\n${result.terminalOutput}\n`)
            }
        }

        filesAfter = countMarkdownFiles(projectDir)
        nodesCreated = countStormOutputNodes(projectDir)

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
        if (app && rendererScreenshots !== null) {
            try {
                await rendererScreenshots.stop()
                process.stdout.write(`[mvp] saved renderer screenshots: ${rendererScreenshots.dir}\n`)
                rendererScreenshots = null
            } catch (e) {
                process.stderr.write(`[mvp] renderer screenshot save failed: ${(e as Error).message}\n`)
                failureReason ??= `renderer screenshot save failed: ${(e as Error).message}`
                pass = false
            }
        }

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

        await shutdownTmuxServer({ voicetreeHomePath }).catch(() => undefined)

        if (!args.keepArtifacts) {
            rmSync(projectRoot, { recursive: true, force: true })
            rmSync(voicetreeHomePath, { recursive: true, force: true })
        } else {
            process.stdout.write(`[mvp] artifacts kept: project=${projectRoot} voicetreeHome=${voicetreeHomePath}\n`)
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
        daemonDiscoveryMs,
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
        daemonUrl: daemonClient?.endpoint.url ?? '',
        projectDir,
        voicetreeHomePath,
        electronLogPath,
        perfRunDir: runContext.runDir,
        screenshotDir: path.join(runContext.runDir, 'screenshots'),
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

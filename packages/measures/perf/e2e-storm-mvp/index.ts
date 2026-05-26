/**
 * e2e-storm-mvp orchestrator.
 *
 * Minimal end-to-end perf-architecture smoke: launches the real Electron
 * VoiceTree main bundle, lets it boot the daemon + MCP server against a
 * freshly seeded vault, discovers the MCP port from `.mcp.json`, spawns 10
 * vt-fake-agents that each create 10 nodes via real MCP, then asserts the
 * expected markdown files landed on disk.
 *
 * Profilers, NDJSON span aggregation, and CDP wiring are deliberately out
 * of scope — those layer on top once this baseline stays green.
 *
 * Run:
 *   node --import tsx packages/measures/perf/e2e-storm-mvp/index.ts
 *
 * Exit code: 0 on pass, 1 on fail.
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { fileURLToPath } from 'node:url'

import { killOrphanVtGraphdDaemons } from '@vt/graph-db-client'
import { generateVaultOnDisk } from '@vt/perf-fixtures'

import { launchElectronAndDiscoverMcp } from './launchElectron.ts'
import { runFakeAgent, buildMultiCreateNodeScript, type FakeAgentResult } from './runFakeAgent.ts'
import { countMarkdownFiles, writeReportAndSummary } from './report.ts'
import { computePerfRunDir, flushAndStopVtGraphd, forceStopVtGraphd } from './perfProfile.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// measures/perf/e2e-storm-mvp -> measures/perf -> measures -> packages -> repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')
const AGENT_COUNT = 10
const NODES_PER_AGENT = 10
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

function wallTimeStats(results: readonly FakeAgentResult[]) {
    const sorted = results.map(r => r.wallMs).sort((a, b) => a - b)
    return {
        p50: percentile(sorted, 50),
        p99: percentile(sorted, 99),
        max: sorted[sorted.length - 1] ?? 0,
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
    let nodesCreated = 0
    let filesAfter = filesBefore
    let app: Awaited<ReturnType<typeof launchElectronAndDiscoverMcp>>['app'] | null = null

    try {
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

        // Pick the first cluster node as the agent's parent — anchors the new
        // node under a real existing node, the way real agents work.
        const seedNodeAbsolutePath = path.join(
            vaultDir,
            vaultLayout.firstClusterNodePaths[0] ?? vaultLayout.nodes[0].relativePath,
        )

        const appWindow = await app.firstWindow({ timeout: 30_000 })
        appWindow.on('pageerror', (e) => process.stderr.write(`[mvp] page error: ${e.message}\n`))
        await appWindow.waitForLoadState('domcontentloaded')

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
            // Electron's `terminal:spawn` IPC creates a TerminalRecord
            // referencing a long-lived tmux session that doesn't get torn
            // down on the agent's process.exit. There's no `terminal:dispose`
            // IPC exposed (webapp only ships `terminal:spawn`), so a graceful
            // `app.close()` hangs waiting on the orphaned tmux. We've already
            // captured every metric the report cares about by this point —
            // SIGKILL the electron process tree as the canonical exit path.
            const electronPid = app.process().pid
            const closeWithTimeout = Promise.race([
                app.close().then(() => 'closed' as const),
                new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 5_000)),
            ])
            try {
                const outcome = await closeWithTimeout
                if (outcome === 'timeout') {
                    process.stdout.write(`[mvp] electron close timed out after 5s — SIGKILL pid=${electronPid}\n`)
                    if (electronPid !== undefined) {
                        try { process.kill(electronPid, 'SIGKILL') } catch { /* already gone */ }
                    }
                }
            } catch (e) {
                process.stderr.write(`[mvp] electron close failed: ${(e as Error).message}\n`)
                if (electronPid !== undefined) {
                    try { process.kill(electronPid, 'SIGKILL') } catch { /* already gone */ }
                }
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
        nodesCreated,
        filesBefore,
        filesAfter,
        mcpPort,
        vaultDir,
        projectDir,
        appSupportPath,
        electronLogPath,
        perfRunDir: perfProfile.runDir,
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

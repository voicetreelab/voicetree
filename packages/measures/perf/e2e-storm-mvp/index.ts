/**
 * e2e-storm-mvp orchestrator.
 *
 * Minimal end-to-end perf-architecture smoke: launches the real Electron
 * VoiceTree main bundle, lets it boot the daemon + MCP server against a
 * freshly seeded vault, discovers the MCP port from `.mcp.json`, spawns ONE
 * vt-fake-agent that creates ONE node via real MCP, then asserts a new
 * markdown file landed on disk.
 *
 * Profilers, NDJSON span aggregation, CDP wiring, and multi-agent storms
 * are deliberately out of scope — those layer on top once this baseline
 * stays green.
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
import { runFakeAgent, buildSingleCreateNodeScript } from './runFakeAgent.ts'
import { countMarkdownFiles, writeReportAndSummary } from './report.ts'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// measures/perf/e2e-storm-mvp -> measures/perf -> measures -> packages -> repo root
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..')

interface Args {
    readonly keepArtifacts: boolean
    readonly mcpDiscoveryTimeoutMs: number
    readonly agentTimeoutMs: number
    readonly inspectPort: number
    readonly outPath: string | null
}

function parseArgs(argv: readonly string[]): Args {
    let keepArtifacts = false
    let mcpDiscoveryTimeoutMs = 120_000
    let agentTimeoutMs = 120_000
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
                    + '  --agent-timeout-ms MS           default 120000\n'
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
    let agentWallMs = 0
    let agentExitCode: number | null = null
    let agentSignal: NodeJS.Signals | null = null
    let agentTimedOut = false
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

        const script = buildSingleCreateNodeScript('MVP First Node')
        const agentResult = await runFakeAgent({
            appWindow,
            repoRoot: REPO_ROOT,
            vaultDir,
            mcpPort,
            seedNodeAbsolutePath,
            terminalId: 'e2e-mvp-agent-0',
            script,
            timeoutMs: args.agentTimeoutMs,
        })
        agentWallMs = agentResult.wallMs
        agentExitCode = agentResult.exitedCleanly ? 0 : -1
        agentSignal = null
        agentTimedOut = agentResult.timedOut

        if (agentResult.headlessOutput) {
            process.stdout.write(`[mvp] agent headless output:\n${agentResult.headlessOutput}\n`)
        }

        filesAfter = countMarkdownFiles(vaultDir)

        if (!agentResult.spawnSuccess) {
            failureReason = `agent spawn failed: ${agentResult.spawnError}`
        } else if (agentResult.timedOut) {
            failureReason = `agent timed out after ${args.agentTimeoutMs}ms (no [fake-agent] Script complete in output)`
        } else if (!agentResult.exitedCleanly) {
            failureReason = `agent reported failure in output`
        } else if (filesAfter <= filesBefore) {
            failureReason = `no new markdown files written (before=${filesBefore}, after=${filesAfter})`
        } else {
            pass = true
        }
    } catch (err) {
        failureReason = (err as Error).message
        if ((err as Error).stack) process.stderr.write(`[mvp] ${(err as Error).stack}\n`)
    } finally {
        if (app) {
            try {
                await app.close()
            } catch (e) {
                process.stderr.write(`[mvp] electron close failed: ${(e as Error).message}\n`)
            }
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
        agentWallMs,
        agentExitCode,
        agentSignal,
        agentTimedOut,
        filesBefore,
        filesAfter,
        mcpPort,
        vaultDir,
        projectDir,
        appSupportPath,
        electronLogPath,
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

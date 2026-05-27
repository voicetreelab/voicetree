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
 *   - The fake-agent script is the same `create_nodes` × N flow agent-storm.ts
 *     uses; only the *fake-agent* is mocked, the daemon + MCP + watch-folder
 *     are real.
 *
 * Run:
 *   npm run perf:main-storm:local -- --agents 5 --nodes-per-agent 5
 *   npm run perf:main-storm       -- --agents 5 --nodes-per-agent 5  (via Onidel)
 */

import {
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'

import { agentRuntime } from '@vt/agent-runtime'
import { generateVaultOnDisk } from '@vt/perf-fixtures'

import {
    analyzeMainProcessProfile,
    printMainProcessMetrics,
    startMainProcessProfile,
    stopMainProcessProfileAndSave,
    type MainProcessCdpHandle,
} from './_shared/main-process-cdp.ts'
import { parseArgs } from './electron-main-storm/args.ts'
import { spawnElectron, stopElectron, waitForMcpPort } from './electron-main-storm/electron.ts'
import { resolveElectronBinary, resolveMainBundleEntry } from './electron-main-storm/paths.ts'
import { runStorm } from './electron-main-storm/storm.ts'

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
        process.stdout.write(`[main-storm] electron pid=${electronProc.pid} inspect=${inspectPort}\n`)

        const mcpPort = await waitForMcpPort(tempVault, args.bootTimeoutMs)
        process.stdout.write(`[main-storm] discovered MCP port=${mcpPort}\n`)

        // Start the CPU profiler *before* the storm so all spawn-time cost is
        // captured. The first inspector connection can race with the daemon's
        // own setup spans, but we accept that — they're outside our hot path.
        cdpHandle = await startMainProcessProfile(inspectPort)
        const profileStartedAt = Date.now()
        process.stdout.write(`[main-storm] CPU profile started\n`)

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

        const outPath = args.outPath ?? join(
            homedir(), '.voicetree', 'reports',
            `electron-main-storm-${Date.now()}.cpuprofile`,
        )
        const outDir = dirname(outPath)
        const outName = outPath.slice(outDir.length + 1)
        mkdirSync(outDir, { recursive: true })

        const cpuprofilePath = await stopMainProcessProfileAndSave(cdpHandle, outDir, outName)
        cdpHandle = null
        const profileWallMs = Date.now() - profileStartedAt
        process.stdout.write(`[main-storm] CPU profile saved (${profileWallMs}ms window): ${cpuprofilePath}\n`)

        const profileJson = readFileSync(cpuprofilePath, 'utf8')
        const metrics = analyzeMainProcessProfile(profileJson)
        printMainProcessMetrics(metrics)

        process.stdout.write('\n=== electron-main-storm summary ===\n')
        process.stdout.write(`agents:        ${args.agents} requested, ${completed} ok, ${failed} failed, ${timedOut} timed out\n`)
        process.stdout.write(`nodes/agent:   ${args.nodesPerAgent}\n`)
        process.stdout.write(`storm wall:    ${stormWallMs}ms\n`)
        process.stdout.write(`profile wall:  ${profileWallMs}ms\n`)
        process.stdout.write(`cpuprofile:    ${cpuprofilePath}\n`)
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

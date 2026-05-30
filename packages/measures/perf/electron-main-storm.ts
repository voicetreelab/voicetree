/**
 * Perf harness: electron-main-storm.
 *
 * Spawns the prebuilt VoiceTree Electron app with `--inspect=0`, lets it boot
 * its own graph-db daemon against a freshly seeded temp project, then storms
 * it with N tmux-backed `vt-fake-agent` subprocesses pointed at the app-owned
 * daemon `/rpc` endpoint — all while capturing a sampling CPU profile of the
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
 *   - The fake-agent script is the same `create_node` × N flow agent-storm.ts
 *     uses; only the *fake-agent* is mocked, the daemon + watch-folder
 *     are real.
 *
 * Discovery (post-MCP-cutover):
 *   The MCP→CLI cutover (commits 2651ade78, fab76e7d4, 15595a854) removed the
 *   in-process MCP server and replaced its `.mcp.json` handshake with
 *   `.voicetree/rpc.port` + `.voicetree/auth-token`. Boot discovery resolves
 *   the daemon URL through `waitForDaemonUrl` (rpc.port poll via `@vt/vt-rpc`);
 *   the spawned fake-agents self-authenticate from `VOICETREE_PROJECT_PATH`.
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

import { terminalRuntimeSurface as agentRuntime } from '@vt/vt-daemon/agent-runtime/agent-control/terminalRuntimeSurface.ts'
import {configureAgentRuntime} from '@vt/vt-daemon/agent-runtime/runtime/runtime-config.ts'
import {
    createTerminalData,
    type TerminalData,
    type TerminalId,
} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import { generateProjectOnDisk } from '@vt/perf-fixtures'

import {
    analyzeMainProcessProfile,
    printMainProcessMetrics,
    startMainProcessProfile,
    stopMainProcessProfileAndSave,
    type MainProcessCdpHandle,
} from './_shared/main-process-cdp.ts'

import {
    buildAgentPrompt,
    buildFakeAgentScript,
    resolveFakeAgentEntrypoint,
    resolveTsxImportPath,
} from './agent-storm-helpers.ts'

import {
    parseElectronMainStormArgs,
    resolveElectronBinary,
    resolveMainBundleEntry,
    spawnElectron,
    stopElectron,
    waitForExitOrTimeout,
    waitForDaemonUrl,
    type AgentResult,
} from './electron-main-storm-helpers.ts'

// ---------------------------------------------------------------------------
// Fake-agent storm
// ---------------------------------------------------------------------------

async function runStorm(args: {
    daemonUrl: string
    project: string
    voicetreeHome: string
    agents: number
    nodesPerAgent: number
    perAgentTimeoutMs: number
}): Promise<readonly AgentResult[]> {
    const { dir: fakeAgentDir, entry: fakeAgentEntrypoint } = resolveFakeAgentEntrypoint()
    const tsxImportPath = resolveTsxImportPath()

    // Set VOICETREE_HOME_PATH so every leaf in this process resolves the
    // perf-test voicetree-home dir via resolveVoicetreeHomePath().
    process.env.VOICETREE_HOME_PATH = args.voicetreeHome

    configureAgentRuntime({
        env: {},
    })

    await agentRuntime.ensureTmuxAvailable()
    await agentRuntime.ensureTmuxServer()

    const script = buildFakeAgentScript(args.nodesPerAgent)
    const agentPrompt = buildAgentPrompt(script)

    const exitedTerminals = new Map<string, { code: number; atMs: number }>()
    const onData = (_id: string, _data: string): void => { /* drop; profile is the artifact */ }
    const onExit = (id: string, exitCode: number): void => {
        if (!exitedTerminals.has(id)) exitedTerminals.set(id, { code: exitCode, atMs: Date.now() })
    }

    const launches: Promise<AgentResult>[] = []
    for (let i = 0; i < args.agents; i++) {
        const terminalId = `perf-agent-${i}` as TerminalId
        const initialEnvVars: Record<string, string> = {
            VOICETREE_TERMINAL_ID: terminalId,
            VOICETREE_DAEMON_URL: args.daemonUrl,
            VOICETREE_PROJECT_PATH: args.project,
            TASK_NODE_PATH: `${args.project}/${terminalId}-task.md`,
            AGENT_PROMPT: agentPrompt,
        }
        const td: TerminalData = createTerminalData({
            terminalId,
            attachedToNodeId: args.project,
            terminalCount: i,
            title: terminalId,
            agentName: terminalId,
            isHeadless: true,
            initialEnvVars,
            initialCommand: `${JSON.stringify(process.execPath)} --import ${JSON.stringify(tsxImportPath)} ${JSON.stringify(fakeAgentEntrypoint)}; exit`,
            executeCommand: true,
            initialSpawnDirectory: fakeAgentDir,
        })

        launches.push((async (): Promise<AgentResult> => {
            const spawnRes = await agentRuntime.getTerminalManager().spawnTmuxBacked({
                terminalData: td,
                getToolsDirectory: () => fakeAgentDir,
                onData,
                onExit,
            })
            if (!spawnRes.success) {
                return {
                    terminalId,
                    spawnSuccess: false,
                    exitCode: -1,
                    exitedAtMs: Date.now(),
                    errorMessage: spawnRes.error ?? 'spawn failed',
                }
            }
            const exit = await waitForExitOrTimeout(
                () => exitedTerminals.get(terminalId),
                () => agentRuntime.getTerminalRecords().find((r) => r.terminalId === terminalId)?.status === 'exited',
                args.perAgentTimeoutMs,
            )
            return {
                terminalId,
                spawnSuccess: true,
                exitCode: exit?.code ?? null,
                exitedAtMs: exit?.atMs ?? null,
            }
        })())
    }

    return Promise.all(launches)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
    const args = parseElectronMainStormArgs(process.argv.slice(2))

    const electronBinary = resolveElectronBinary()
    const mainEntry = resolveMainBundleEntry()

    const tempProject = mkdtempSync(join(tmpdir(), 'vt-mainstorm-project-'))
    const tempUserData = mkdtempSync(join(tmpdir(), 'vt-mainstorm-userdata-'))
    const tempVoicetreeHome = mkdtempSync(join(tmpdir(), 'vt-mainstorm-appsupport-'))

    const projectLayout = generateProjectOnDisk(tempProject, args.projectSeedNodeCount)
    process.stdout.write(`[main-storm] seeded project: ${projectLayout.nodes.length} nodes at ${tempProject}\n`)

    let electronProc: ChildProcessWithoutNullStreams | null = null
    let cdpHandle: MainProcessCdpHandle | null = null

    try {
        const spawned = await spawnElectron({
            electronBinary,
            mainEntry,
            userDataDir: tempUserData,
            openFolder: tempProject,
            bootTimeoutMs: args.bootTimeoutMs,
        })
        electronProc = spawned.proc
        const inspectPort = spawned.inspectPort
        process.stdout.write(`[main-storm] electron pid=${electronProc.pid} inspect=${inspectPort}\n`)

        // Discover the daemon URL from `<project>/.voicetree/rpc.port` (waiting
        // for the sibling auth-token too). The fake-agents storm against this
        // URL and self-authenticate from VOICETREE_PROJECT_PATH.
        const daemonUrl = await waitForDaemonUrl(tempProject, args.bootTimeoutMs)
        process.stdout.write(`[main-storm] discovered daemon at ${daemonUrl}\n`)

        // Start the CPU profiler *before* the storm so all spawn-time cost is
        // captured. The first inspector connection can race with the daemon's
        // own setup spans, but we accept that — they're outside our hot path.
        cdpHandle = await startMainProcessProfile(inspectPort)
        const profileStartedAt = Date.now()
        process.stdout.write(`[main-storm] CPU profile started\n`)

        const stormStart = Date.now()
        const results = await runStorm({
            daemonUrl,
            project: tempProject,
            voicetreeHome: tempVoicetreeHome,
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
            rmSync(tempProject, { recursive: true, force: true })
            rmSync(tempUserData, { recursive: true, force: true })
            rmSync(tempVoicetreeHome, { recursive: true, force: true })
        } else {
            process.stdout.write(`[main-storm] artifacts kept: project=${tempProject} userData=${tempUserData} voicetreeHome=${tempVoicetreeHome}\n`)
        }
    }
}

void main().catch((err: unknown) => {
    process.stderr.write(`[main-storm] fatal: ${(err as Error).message}\n`)
    if (err instanceof Error && err.stack) process.stderr.write(err.stack + '\n')
    process.exit(1)
})

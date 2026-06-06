/**
 * Perf harness: agent-storm.
 *
 * Boots an in-process headless VoiceTree (graph-db-server + the unified
 * @vt/vt-daemon HTTP server + agent-runtime, no Electron) against a fresh
 * temp project, then spawns N tmux-backed `vt-fake-agent` terminals in
 * parallel. Each fake-agent runs a deterministic script of `create_nodes`
 * actions, which exercise the real `create_graph` tool over the daemon's
 * `/rpc` JSON-RPC endpoint and the daemon-routed project write path
 * end-to-end.
 *
 * Why this exists: the existing perf tests measure Cytoscape layout, SSE
 * round-trip, and daemon-spawn serialization — none of them drive realistic
 * agent activity that touches the new OTel observability surface
 * (vt-graphd.ndjson, daemon.* spans, traceparent stitching). This harness
 * does, so a regression like "renderer 99% CPU under daemon-recovery storm"
 * can be reproduced under controlled load and root-caused via trace counts /
 * latency histograms rather than guesswork.
 *
 * Honest scope:
 * - This exercises the *daemon side* of the stack (vt-graphd + unified HTTP
 *   daemon + agent-runtime + fake-agent → real `.md` files in the project).
 *   The new webapp electron-main observability (`vt-electron-daemon.ndjson`)
 *   is NOT exercised because there is no Electron process in this harness.
 *   If a regression survives this harness, it is electron-main-specific and
 *   needs a Playwright-driven Electron variant.
 * - Real `.md` files are written. Real tmux sessions are spawned. Cleanup
 *   removes the temp project and tmux sessions on exit.
 */

import { dirname, join, resolve } from 'node:path'
import { homedir, tmpdir } from 'node:os'
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

import {
    startDaemon,
    type DaemonHandle,
} from '@vt/graph-db-server'
import { tracing } from '@vt/observability'
import {
    startHttpDaemonServer,
    type HttpDaemonServerHandle,
} from '@vt/vt-daemon/transport/httpServer.ts'
import type {ToolBridges} from '@vt/vt-daemon/config/toolBridges.ts'
import {setCurrentProject} from '@vt/vt-daemon/state/currentProject.ts'
import {buildDefaultToolCatalog} from '@vt/vt-daemon/transport/toolCatalog.ts'
import {registerChildIfMonitored} from '@vt/vt-daemon/agent-runtime/agent-control/agent-completion-monitor.ts'
import {
    generateAuthToken,
    writeAuthTokenFile,
    writeRpcPortFile,
} from '@vt/vt-rpc'
import { terminalRuntimeSurface as agentRuntime } from '@vt/vt-daemon/agent-runtime/agent-control/terminalRuntimeSurface.ts'
import {configureAgentRuntime} from '@vt/vt-daemon/agent-runtime/runtime/runtime-config.ts'
import {
    createTerminalData,
    type TerminalData,
    type TerminalId,
} from '@vt/vt-daemon/agent-runtime/terminals/terminal-registry/types.ts'
import { GraphDbClient } from '@vt/graph-db-client'
import {
    rehydrateSerializedGraph,
    type Graph,
} from '@vt/graph-model/graph'
import { generateProjectOnDisk } from '@vt/perf-fixtures'
import {
    type AgentStormArgs,
    type SpanRecord,
    buildAgentPrompt,
    buildFakeAgentScript,
    countMarkdownFiles,
    ndjsonFileSize,
    parseAgentStormArgs,
    readNdjsonTail,
    resolveFakeAgentEntrypoint,
    resolveTsxImportPath,
    summarizeSpans,
} from './agent-storm-helpers'

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
        // Headless agents may not deliver onExit through spawnTmuxBacked's
        // callback (tmux session can outlive the node process). Fall back to
        // the registry status — `exited` is the canonical signal.
        const record = agentRuntime.getTerminalRecords().find(r => r.terminalId === terminalId)
        if (record?.status === 'exited') {
            const entry = { code: 0, atMs: Date.now() }
            exitedTerminals.set(terminalId, entry)
            return entry
        }
        await new Promise(r => setTimeout(r, 200))
    }
    return null
}

async function main(): Promise<void> {
    const args: AgentStormArgs = parseAgentStormArgs(process.argv.slice(2))

    // Bootstrap tracing BEFORE any graph-db-server / agent-runtime imports
    // create spans we want recorded.
    tracing.init('vt-graphd')

    const tempProject = mkdtempSync(join(tmpdir(), 'vt-perf-project-'))
    const tempVoicetreeHome = mkdtempSync(join(tmpdir(), 'vt-perf-app-'))

    // Seed the project with a deterministic graph of N existing nodes BEFORE
    // the daemon scans it. This matches real-world conditions (agents always
    // run against projects with prior content) and gives each fake-agent a
    // valid parent node to attach to. An empty project would only have the
    // auto-generated "starter" node, which is fine for 1 agent but not for
    // a multi-agent storm — they'd all dogpile on the same parent and the
    // measurement would be dominated by parent-resolution serialization.
    const projectLayout = generateProjectOnDisk(tempProject, args.projectSeedNodeCount)
    process.stdout.write(`[perf] seeded project with ${projectLayout.nodes.length} nodes at ${tempProject}\n`)

    // Snapshot trace file offsets BEFORE any daemon/MCP/project bootstrap fires
    // its setup spans (daemon.start, daemon.open-project, daemon.set-write-path.*)
    // — otherwise we lose all of them to the pre-snapshot prefix.
    const traceDir = join(homedir(), '.voicetree', 'traces')
    const graphdNdjson = join(traceDir, 'vt-graphd.ndjson')
    const electronNdjson = join(traceDir, 'vt-electron-daemon.ndjson')
    const graphdOffset = ndjsonFileSize(graphdNdjson)
    const electronOffset = ndjsonFileSize(electronNdjson)

    process.env.VOICETREE_HOME_PATH = tempVoicetreeHome
    configureAgentRuntime({
        env: {},
    })

    await agentRuntime.ensureTmuxAvailable()
    await agentRuntime.ensureTmuxServer()

    let daemonHandle: DaemonHandle
    try {
        daemonHandle = await startDaemon({ project: tempProject, voicetreeHomePath: tempVoicetreeHome })
    } catch (err) {
        throw new Error(`startDaemon failed: ${(err as Error).message}`)
    }
    if (daemonHandle.alreadyRunning) {
        throw new Error(
            `graph-db-server already running for ${tempProject} (pid ${daemonHandle.alreadyRunning.pid}). `
            + `That should not be possible for a freshly-created temp project.`,
        )
    }

    // Wire MCP graph bridge to talk to the in-process daemon via HTTP. In
    // production (Electron) this bridge points at the GraphDbClient bound to
    // the active project; the standalone vtd binary headless leaves it
    // unconfigured by design (CLI agents write via raw FS instead of
    // create_graph). The perf harness
    // EXPLICITLY exercises create_graph because that is the path we suspect
    // creates load — so we configure the bridge here, identical in shape to
    // webapp's `main.ts` wiring.
    const daemonBaseUrl = `http://127.0.0.1:${daemonHandle.port}`
    const daemonClient = new GraphDbClient({ baseUrl: daemonBaseUrl })
    const openResult = await daemonClient.openProject(tempProject, { writeFolderPath: tempProject })
    setCurrentProject(tempProject)

    // The daemon serializes Graph over JSON, which collapses the Graph-level Map
    // indexes (nodeByBaseName, incomingEdgesIndex, unresolvedLinksIndex) into
    // plain objects; createGraphTool assumes the Map types. `rehydrateSerializedGraph`
    // (the canonical graph-model helper, also used by the webapp and daemon bridges)
    // rebuilds them, so the perf harness exercises the same production path.
    const toolBridges: ToolBridges = {
        graph: {
            getGraph: async (): Promise<Graph> => {
                const raw = await daemonClient.getGraph()
                const nodes = (typeof raw === 'object' && raw !== null && 'nodes' in raw)
                    ? (raw as { nodes: Record<string, unknown> }).nodes
                    : {}
                return rehydrateSerializedGraph({ nodes })
            },
            getProjectPaths: async () => {
                // ProjectState has {projectRoot, readPaths, writeFolderPath}. Match the
                // webapp's getProjectPaths: writeFolderPath first, then any extra
                // readPaths. createGraph compares against this list to gate
                // outputPath placement.
                const vs = await daemonClient.getProject()
                const seen = new Set<string>()
                const out: string[] = []
                for (const p of [vs.writeFolderPath, ...vs.readPaths]) {
                    if (!seen.has(p)) { seen.add(p); out.push(p) }
                }
                return out
            },
            getWriteFolderPath: async () => (await daemonClient.getProject()).writeFolderPath ?? null,
            applyGraphDelta: async (delta, recordForUndo) => {
                await daemonClient.applyGraphDelta(delta as unknown as unknown[], {
                    recordForUndo: recordForUndo ?? true,
                    sessionId: openResult.sessionId,
                })
            },
        },
    }

    // Bearer auth token: ephemeral per-run. The fake-agent subprocess
    // discovers it from the temp project's .voicetree/auth-token file via
    // @vt/vt-rpc discovery; we also publish the rpc.port file so the same
    // discovery chain finds the port without an env override.
    const token: string = generateAuthToken()
    await writeAuthTokenFile(tempProject, token)

    let httpHandle: HttpDaemonServerHandle
    try {
        httpHandle = await startHttpDaemonServer({
            catalog: buildDefaultToolCatalog(toolBridges),
            token,
            bindHost: '127.0.0.1',
            port: undefined,
        })
        await writeRpcPortFile(tempProject, httpHandle.port)
    } catch (err) {
        await daemonHandle.stop().catch(() => undefined)
        throw new Error(`startHttpDaemonServer failed: ${(err as Error).message}`)
    }

    process.stdout.write(
        `[perf] daemon=${httpHandle.url} graphd port=${daemonHandle.port} `
        + `project=${tempProject} voicetree-home=${tempVoicetreeHome}\n`,
    )

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

    if (projectLayout.nodes.length < args.agents) {
        throw new Error(
            `--project-seed-nodes (${args.projectSeedNodeCount}) produced only ${projectLayout.nodes.length} `
            + `nodes, fewer than --agents (${args.agents}). Increase --project-seed-nodes.`,
        )
    }

    const wallStart = Date.now()
    const agentLaunches: Promise<AgentResult>[] = []
    for (let i = 0; i < args.agents; i++) {
        const terminalId = `perf-agent-${i}` as TerminalId
        // Spread agents across the cluster-firsts (each agent gets a distinct
        // parent node — no dogpile on a single parent). If we exhaust those,
        // fall back to picking from the full node list.
        const seedNode = i < projectLayout.firstClusterNodePaths.length
            ? projectLayout.firstClusterNodePaths[i]
            : projectLayout.nodes[i % projectLayout.nodes.length].relativePath
        const attachedToNodeId = join(tempProject, seedNode)
        // Under --isolate-dirs every agent gets its own pre-created output
        // directory inside the project. Without it, create_graph defaults to
        // the project write-path root, so all agents pile their writes into
        // the same directory.
        const isolatedDir = args.isolateDirs ? join(tempProject, 'isolated', terminalId) : null
        if (isolatedDir) mkdirSync(isolatedDir, { recursive: true })
        const initialEnvVars: Record<string, string> = {
            VOICETREE_TERMINAL_ID: terminalId,
            VOICETREE_DAEMON_URL: httpHandle.url,
            VOICETREE_PROJECT_PATH: tempProject,
            TASK_NODE_PATH: `${tempProject}/${terminalId}-task.md`,
            AGENT_PROMPT: agentPrompt,
        }
        if (isolatedDir) initialEnvVars.VOICETREE_OUTPUT_DIR = isolatedDir
        const td: TerminalData = createTerminalData({
            terminalId,
            attachedToNodeId,
            terminalCount: i,
            title: terminalId,
            agentName: terminalId,
            isHeadless: true,
            initialEnvVars,
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
        process.stderr.write(`[perf] ${(err as Error).message}\n`)
        // Continue to teardown + reporting on a best-effort basis.
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

    const filesCreated = countMarkdownFiles(tempProject)

    // Tear down: HTTP daemon → terminals → graph-db. (Note: the standalone
    // vtd binary no longer embeds graph-db, but this perf harness still does
    // — graphd shutdown happens here only because we own the spawn locally.)
    await httpHandle.stop().catch((e: unknown) => process.stderr.write(`[perf] http daemon stop: ${(e as Error).message}\n`))
    agentRuntime.getTerminalManager().cleanup()
    await agentRuntime.shutdownTmuxServer({voicetreeHomePath: tempVoicetreeHome}).catch(() => undefined)
    await daemonHandle.stop().catch((e: unknown) => process.stderr.write(`[perf] daemon stop: ${(e as Error).message}\n`))

    const graphdSpans = readNdjsonTail(graphdNdjson, graphdOffset)
    const electronSpans = readNdjsonTail(electronNdjson, electronOffset)
    const graphdSummary = summarizeSpans(graphdSpans)
    const electronSummary = summarizeSpans(electronSpans)

    const completedCount = agentResults.filter(r => r.exitCode === 0).length
    const failedCount = agentResults.filter(r => r.exitedAtMs !== null && r.exitCode !== 0).length
    const timedOutCount = agentResults.filter(r => r.exitedAtMs === null).length

    const report = {
        args: { ...args, variant: 'daemon-only' as const },
        wallMs,
        agentCount: agentResults.length,
        completedCount,
        failedCount,
        timedOutCount,
        filesCreated,
        projectPath: tempProject,
        voicetreeHomePath: tempVoicetreeHome,
        spans: { vtGraphd: graphdSummary, vtElectronDaemon: electronSummary },
        agents: agentResults,
    }

    const outPath = args.outPath ?? join(homedir(), '.voicetree', 'reports', `perf-agent-storm-${Date.now()}.json`)
    mkdirSync(dirname(outPath), { recursive: true })
    writeFileSync(outPath, JSON.stringify(report, null, 2))

    process.stdout.write('\n=== perf-agent-storm summary ===\n')
    process.stdout.write(`agents:        ${args.agents} requested, ${completedCount} ok, ${failedCount} failed, ${timedOutCount} timed out\n`)
    process.stdout.write(`nodes/agent:   ${args.nodesPerAgent}\n`)
    process.stdout.write(`wall time:     ${wallMs}ms\n`)
    process.stdout.write(`files written: ${filesCreated} (${(filesCreated / Math.max(1, wallMs / 1000)).toFixed(1)}/sec)\n`)
    process.stdout.write(`vt-graphd spans (new):        ${graphdSummary.totalNew}\n`)
    for (const [name, n] of Object.entries(graphdSummary.byName).sort()) {
        const d = graphdSummary.durationsMs[name]
        process.stdout.write(`  ${name.padEnd(40)}  n=${String(n).padStart(5)}  p50=${d.p50.toFixed(1)}ms  p95=${d.p95.toFixed(1)}ms  max=${d.max.toFixed(1)}ms\n`)
    }
    for (const [key, n] of Object.entries(graphdSummary.byOutcome).sort()) {
        process.stdout.write(`  outcome ${key.padEnd(50)}  n=${n}\n`)
    }
    process.stdout.write(`vt-electron-daemon spans (new): ${electronSummary.totalNew} (expected 0 — harness has no Electron)\n`)
    process.stdout.write(`report:        ${outPath}\n`)

    if (!args.keepArtifacts) {
        rmSync(tempProject, { recursive: true, force: true })
        rmSync(tempVoicetreeHome, { recursive: true, force: true })
    } else {
        process.stdout.write(`artifacts kept: project=${tempProject} voicetreeHome=${tempVoicetreeHome}\n`)
    }

    const exitCode = failedCount > 0 || timedOutCount > 0 ? 1 : 0
    process.exit(exitCode)
}

void main().catch((err: unknown) => {
    process.stderr.write(`[perf] fatal: ${(err as Error).message}\n`)
    if (err instanceof Error && err.stack) process.stderr.write(err.stack + '\n')
    process.exit(1)
})

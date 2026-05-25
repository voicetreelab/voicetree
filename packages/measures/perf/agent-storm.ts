/**
 * Perf harness: agent-storm.
 *
 * Boots an in-process headless VoiceTree (graph-db-server + voicetree-mcp +
 * agent-runtime, no Electron) against a fresh temp vault, then spawns N
 * tmux-backed `vt-fake-agent` terminals in parallel. Each fake-agent runs a
 * deterministic script of `create_node` actions, which exercise the real MCP
 * `create_graph` tool and the daemon-routed vault write path end-to-end.
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
 * - This exercises the *daemon side* of the stack (vt-graphd + MCP +
 *   agent-runtime + fake-agent → real `.md` files in the vault). The new
 *   webapp electron-main observability (`vt-electron-daemon.ndjson`) is
 *   NOT exercised because there is no Electron process in this harness.
 *   If a regression survives this harness, it is electron-main-specific and
 *   needs a Playwright-driven Electron variant.
 * - Real `.md` files are written. Real tmux sessions are spawned. Cleanup
 *   removes the temp vault and tmux sessions on exit.
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
    configureMcpServer,
    getMcpPort,
    registerChildIfMonitored,
    startMcpServer,
    type McpServerHandle,
} from '@vt/voicetree-mcp'
import { agentRuntime, configureAgentRuntime } from '@vt/agent-runtime'
import {
    createTerminalData,
    type TerminalData,
    type TerminalId,
} from '@vt/agent-runtime/types'
import { GraphDbClient } from '@vt/graph-db-client'
import {
    applyGraphDeltaToGraph,
    createEmptyGraph,
    mapNewGraphToDelta,
    type Graph,
    type GraphNode,
    type NodeIdAndFilePath,
} from '@vt/graph-model/graph'
import { generateVaultOnDisk } from '@vt/perf-fixtures'

interface Args {
    readonly agents: number
    readonly nodesPerAgent: number
    readonly vaultSeedNodeCount: number
    readonly perAgentTimeoutMs: number
    readonly globalTimeoutMs: number
    readonly outPath: string | null
    readonly keepArtifacts: boolean
    readonly isolateDirs: boolean
}

interface AgentResult {
    readonly terminalId: string
    readonly spawnSuccess: boolean
    readonly startedAtMs: number
    readonly exitedAtMs: number | null
    readonly exitCode: number | null
    readonly stdoutSnippet: string
    readonly errorMessage?: string
}

interface SpanRecord {
    readonly traceId: string
    readonly spanId: string
    readonly name: string
    readonly durationMs: number
    readonly attributes: Record<string, unknown>
}

interface SpanSummary {
    readonly totalNew: number
    readonly byName: Record<string, number>
    readonly byOutcome: Record<string, number>
    readonly durationsMs: Record<string, { p50: number; p95: number; p99: number; max: number }>
}

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const require = createRequire(import.meta.url)

function parseArgs(argv: readonly string[]): Args {
    const defaults: Args = {
        agents: 5,
        nodesPerAgent: 5,
        vaultSeedNodeCount: 200,
        perAgentTimeoutMs: 60_000,
        globalTimeoutMs: 5 * 60_000,
        outPath: null,
        keepArtifacts: false,
        isolateDirs: false,
    }
    let agents = defaults.agents
    let nodesPerAgent = defaults.nodesPerAgent
    let vaultSeedNodeCount = defaults.vaultSeedNodeCount
    let perAgentTimeoutMs = defaults.perAgentTimeoutMs
    let globalTimeoutMs = defaults.globalTimeoutMs
    let outPath = defaults.outPath
    let keepArtifacts = defaults.keepArtifacts
    let isolateDirs = defaults.isolateDirs

    const intArg = (raw: string | undefined, name: string): number => {
        const n = Number.parseInt(raw ?? '', 10)
        if (!Number.isInteger(n) || n < 0) throw new Error(`bad --${name}: ${raw}`)
        return n
    }

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i]
        switch (a) {
            case '--agents': agents = intArg(argv[++i], 'agents'); break
            case '--nodes-per-agent': nodesPerAgent = intArg(argv[++i], 'nodes-per-agent'); break
            case '--vault-seed-nodes': vaultSeedNodeCount = intArg(argv[++i], 'vault-seed-nodes'); break
            case '--per-agent-timeout-ms': perAgentTimeoutMs = intArg(argv[++i], 'per-agent-timeout-ms'); break
            case '--global-timeout-ms': globalTimeoutMs = intArg(argv[++i], 'global-timeout-ms'); break
            case '--out': outPath = argv[++i] ?? null; break
            case '--keep-artifacts': keepArtifacts = true; break
            case '--isolate-dirs': isolateDirs = true; break
            case '--help':
            case '-h':
                process.stdout.write(
                    'agent-storm.ts: spawn N vt-fake-agents and measure daemon-side OTel signals.\n'
                    + '  --agents N                    parallel fake-agents (default 5)\n'
                    + '  --nodes-per-agent N           create_node actions per agent (default 5)\n'
                    + '  --vault-seed-nodes N          existing nodes to seed the vault with (default 200)\n'
                    + '  --per-agent-timeout-ms MS     per-agent completion deadline (default 60000)\n'
                    + '  --global-timeout-ms MS        overall run deadline (default 300000)\n'
                    + '  --out PATH                    JSON report path (default ~/.voicetree/reports/perf-agent-storm-<ts>.json)\n'
                    + '  --keep-artifacts              keep temp vault + app-support dirs after the run\n'
                    + '  --isolate-dirs                give each agent a unique outputDir under <vault>/isolated/agent-<i>/ (probe per-dir FS contention)\n',
                )
                process.exit(0)
            default:
                throw new Error(`unknown argument: ${a}`)
        }
    }
    return { agents, nodesPerAgent, vaultSeedNodeCount, perAgentTimeoutMs, globalTimeoutMs, outPath, keepArtifacts, isolateDirs }
}

function buildFakeAgentScript(nodesPerAgent: number): object {
    const actions: object[] = []
    for (let i = 0; i < nodesPerAgent; i++) {
        actions.push({
            type: 'create_node',
            title: `Perf Node ${i}`,
            summary: `Synthetic node ${i} produced by perf-agent-storm.`,
            content: `Node body for index ${i}. Generated by the perf harness.`,
        })
    }
    actions.push({ type: 'exit', code: 0 })
    return { actions }
}

function buildAgentPrompt(script: object): string {
    return `### FAKE_AGENT_SCRIPT ###\n${JSON.stringify(script)}\n### END_FAKE_AGENT_SCRIPT ###`
}

function resolveFakeAgentEntrypoint(): { dir: string; entry: string } {
    // measures/perf -> measures -> packages -> repo root
    const repoRoot = resolve(__dirname, '..', '..', '..')
    const dir = join(repoRoot, 'tools', 'vt-fake-agent')
    const entry = join(dir, 'src', 'index.ts')
    if (!existsSync(entry)) throw new Error(`vt-fake-agent entrypoint not found at ${entry}`)
    return { dir, entry }
}

function resolveTsxImportPath(): string {
    return require.resolve('tsx')
}

function ndjsonFileSize(path: string): number {
    try { return statSync(path).size } catch { return 0 }
}

function readNdjsonTail(path: string, fromByteOffset: number): SpanRecord[] {
    if (!existsSync(path)) return []
    const buf = readFileSync(path)
    if (buf.length <= fromByteOffset) return []
    const tail = buf.subarray(fromByteOffset).toString('utf8')
    const out: SpanRecord[] = []
    for (const line of tail.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length === 0) continue
        try {
            const parsed = JSON.parse(trimmed) as SpanRecord
            out.push(parsed)
        } catch {
            // skip malformed lines (file may have been written mid-line at snapshot time)
        }
    }
    return out
}

function quantile(sorted: readonly number[], q: number): number {
    if (sorted.length === 0) return 0
    if (sorted.length === 1) return sorted[0]
    const pos = (sorted.length - 1) * q
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    if (lo === hi) return sorted[lo]
    const frac = pos - lo
    return sorted[lo] * (1 - frac) + sorted[hi] * frac
}

function summarizeSpans(spans: readonly SpanRecord[]): SpanSummary {
    const byName: Record<string, number> = {}
    const byOutcome: Record<string, number> = {}
    const durationsByName: Record<string, number[]> = {}
    for (const span of spans) {
        byName[span.name] = (byName[span.name] ?? 0) + 1
        const outcome = (span.attributes?.outcome as string | undefined) ?? null
        if (outcome) {
            const key = `${span.name}/${outcome}`
            byOutcome[key] = (byOutcome[key] ?? 0) + 1
        }
        const list = durationsByName[span.name] ?? (durationsByName[span.name] = [])
        list.push(span.durationMs)
    }
    const durationsMs: SpanSummary['durationsMs'] = {}
    for (const [name, raw] of Object.entries(durationsByName)) {
        const sorted = [...raw].sort((a, b) => a - b)
        durationsMs[name] = {
            p50: quantile(sorted, 0.5),
            p95: quantile(sorted, 0.95),
            p99: quantile(sorted, 0.99),
            max: sorted[sorted.length - 1],
        }
    }
    return { totalNew: spans.length, byName, byOutcome, durationsMs }
}

function countMarkdownFiles(dir: string): number {
    let count = 0
    const walk = (d: string): void => {
        let entries: readonly string[]
        try { entries = readdirSync(d) } catch { return }
        for (const entry of entries) {
            if (entry.startsWith('.')) continue
            const full = join(d, entry)
            let stat
            try { stat = statSync(full) } catch { continue }
            if (stat.isDirectory()) walk(full)
            else if (stat.isFile() && entry.endsWith('.md')) count++
        }
    }
    walk(dir)
    return count
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
    const args = parseArgs(process.argv.slice(2))

    // Bootstrap tracing BEFORE any graph-db-server / agent-runtime imports
    // create spans we want recorded.
    tracing.init('vt-graphd')

    const tempVault = mkdtempSync(join(tmpdir(), 'vt-perf-vault-'))
    const tempAppSupport = mkdtempSync(join(tmpdir(), 'vt-perf-app-'))

    // Seed the vault with a deterministic graph of N existing nodes BEFORE
    // the daemon scans it. This matches real-world conditions (agents always
    // run against vaults with prior content) and gives each fake-agent a
    // valid parent node to attach to. An empty vault would only have the
    // auto-generated "starter" node, which is fine for 1 agent but not for
    // a multi-agent storm — they'd all dogpile on the same parent and the
    // measurement would be dominated by parent-resolution serialization.
    const vaultLayout = generateVaultOnDisk(tempVault, args.vaultSeedNodeCount)
    process.stdout.write(`[perf] seeded vault with ${vaultLayout.nodes.length} nodes at ${tempVault}\n`)

    // Snapshot trace file offsets BEFORE any daemon/MCP/vault bootstrap fires
    // its setup spans (daemon.start, daemon.open-vault, daemon.set-write-path.*)
    // — otherwise we lose all of them to the pre-snapshot prefix.
    const traceDir = join(homedir(), '.voicetree', 'traces')
    const graphdNdjson = join(traceDir, 'vt-graphd.ndjson')
    const electronNdjson = join(traceDir, 'vt-electron-daemon.ndjson')
    const graphdOffset = ndjsonFileSize(graphdNdjson)
    const electronOffset = ndjsonFileSize(electronNdjson)

    configureAgentRuntime({
        env: {
            getAppSupportPath: (): string => tempAppSupport,
            getMcpPort,
        },
        ui: { registerChildIfMonitored },
    })

    await agentRuntime.ensureTmuxAvailable()
    await agentRuntime.ensureTmuxServer()

    let daemonHandle: DaemonHandle
    try {
        daemonHandle = await startDaemon({ vault: tempVault, appSupportPath: tempAppSupport })
    } catch (err) {
        throw new Error(`startDaemon failed: ${(err as Error).message}`)
    }
    if (daemonHandle.alreadyRunning) {
        throw new Error(
            `graph-db-server already running for ${tempVault} (pid ${daemonHandle.alreadyRunning.pid}). `
            + `That should not be possible for a freshly-created temp vault.`,
        )
    }

    // Wire MCP graph bridge to talk to the in-process daemon via HTTP. In
    // production (Electron) this bridge points at the GraphDbClient bound to
    // the active vault; vt-mcpd headless leaves it unconfigured by design
    // (CLI agents write via raw FS instead of create_graph). The perf harness
    // EXPLICITLY exercises create_graph because that is the path we suspect
    // creates load — so we configure the bridge here, identical in shape to
    // webapp's `main.ts` wiring.
    const daemonBaseUrl = `http://127.0.0.1:${daemonHandle.port}`
    const daemonClient = new GraphDbClient({ baseUrl: daemonBaseUrl })
    const openResult = await daemonClient.openVault(tempVault, { writeFolder: tempVault })

    // The daemon serializes Graph over JSON, which collapses Maps (e.g.
    // nodeByBaseName, additionalYAMLProps) into plain objects. createGraphTool
    // assumes Map types on those fields. The webapp's getNormalizedDaemonGraph
    // helper rehydrates by applying a delta-from-graph onto an empty graph,
    // which rebuilds the Map indexes. We replicate that logic here to keep
    // the perf harness honest about exercising the production createGraph
    // path.
    const normalizeDaemonGraph = (raw: { nodes: Record<string, unknown> }): Graph => {
        type SerializableGraphNode = GraphNode & {
            nodeUIMetadata?: GraphNode['nodeUIMetadata'] & {
                additionalYAMLProps?: unknown
            }
        }
        const normalizedNodes = Object.fromEntries(
            Object.entries(raw.nodes).map(([nodeId, rawNode]) => {
                const node = rawNode as SerializableGraphNode
                const additional = node.nodeUIMetadata?.additionalYAMLProps
                const revived: ReadonlyMap<string, string> = additional instanceof Map
                    ? additional
                    : new Map(
                        Object.entries(
                            typeof additional === 'object' && additional !== null
                                ? (additional as Record<string, string>)
                                : {},
                        ),
                    )
                return [
                    nodeId,
                    {
                        ...node,
                        nodeUIMetadata: {
                            ...node.nodeUIMetadata,
                            additionalYAMLProps: revived,
                        },
                    },
                ]
            }),
        ) as Record<NodeIdAndFilePath, GraphNode>
        const emptyGraph: Graph = createEmptyGraph()
        return applyGraphDeltaToGraph(
            emptyGraph,
            mapNewGraphToDelta({ ...emptyGraph, nodes: normalizedNodes }),
        )
    }

    configureMcpServer({
        graph: {
            getGraph: async (): Promise<Graph> => {
                const raw = await daemonClient.getGraph()
                const nodes = (typeof raw === 'object' && raw !== null && 'nodes' in raw)
                    ? (raw as { nodes: Record<string, unknown> }).nodes
                    : {}
                return normalizeDaemonGraph({ nodes })
            },
            getVaultPaths: async () => {
                // VaultState has {projectRoot, readPaths, writeFolder}. Match the
                // webapp's getVaultPaths: writeFolder first, then any extra
                // readPaths. createGraph compares against this list to gate
                // outputPath placement.
                const vs = await daemonClient.getVault()
                const seen = new Set<string>()
                const out: string[] = []
                for (const p of [vs.writeFolder, ...vs.readPaths]) {
                    if (!seen.has(p)) { seen.add(p); out.push(p) }
                }
                return out
            },
            getWriteFolder: async () => (await daemonClient.getVault()).writeFolder ?? null,
            applyGraphDelta: async (delta, recordForUndo) => {
                await daemonClient.applyGraphDelta(delta as unknown as unknown[], {
                    recordForUndo: recordForUndo ?? true,
                    sessionId: openResult.sessionId,
                })
            },
        },
        liveState: {
            applyLiveCommand: (): Promise<never> => Promise.reject(
                new Error('vt_dispatch_live_command not available in perf harness'),
            ),
            getLiveStateSnapshot: (): Promise<never> => Promise.reject(
                new Error('vt_get_live_state not available in perf harness'),
            ),
        },
    })

    let mcpHandle: McpServerHandle
    try {
        mcpHandle = await startMcpServer({ startPort: undefined })
    } catch (err) {
        await daemonHandle.stop().catch(() => undefined)
        throw new Error(`startMcpServer failed: ${(err as Error).message}`)
    }

    process.stdout.write(
        `[perf] mcp port=${mcpHandle.port} graphd port=${daemonHandle.port} `
        + `vault=${tempVault} app-support=${tempAppSupport}\n`,
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

    if (vaultLayout.nodes.length < args.agents) {
        throw new Error(
            `--vault-seed-nodes (${args.vaultSeedNodeCount}) produced only ${vaultLayout.nodes.length} `
            + `nodes, fewer than --agents (${args.agents}). Increase --vault-seed-nodes.`,
        )
    }

    const wallStart = Date.now()
    const agentLaunches: Promise<AgentResult>[] = []
    for (let i = 0; i < args.agents; i++) {
        const terminalId = `perf-agent-${i}` as TerminalId
        // Spread agents across the cluster-firsts (each agent gets a distinct
        // parent node — no dogpile on a single parent). If we exhaust those,
        // fall back to picking from the full node list.
        const seedNode = i < vaultLayout.firstClusterNodePaths.length
            ? vaultLayout.firstClusterNodePaths[i]
            : vaultLayout.nodes[i % vaultLayout.nodes.length].relativePath
        const attachedToNodeId = join(tempVault, seedNode)
        // Under --isolate-dirs every agent gets its own pre-created output
        // directory inside the vault. Without it, create_graph defaults to
        // the vault write-path root, so all agents pile their writes into
        // the same directory.
        const isolatedDir = args.isolateDirs ? join(tempVault, 'isolated', terminalId) : null
        if (isolatedDir) mkdirSync(isolatedDir, { recursive: true })
        const initialEnvVars: Record<string, string> = {
            VOICETREE_TERMINAL_ID: terminalId,
            VOICETREE_MCP_PORT: String(mcpHandle.port),
            VOICETREE_VAULT_PATH: tempVault,
            TASK_NODE_PATH: `${tempVault}/${terminalId}-task.md`,
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

    const filesCreated = countMarkdownFiles(tempVault)

    // Tear down in the same order vt-mcpd uses on SIGTERM.
    await mcpHandle.stop().catch((e: unknown) => process.stderr.write(`[perf] mcp stop: ${(e as Error).message}\n`))
    agentRuntime.getTerminalManager().cleanup()
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
        vaultPath: tempVault,
        appSupportPath: tempAppSupport,
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
        rmSync(tempVault, { recursive: true, force: true })
        rmSync(tempAppSupport, { recursive: true, force: true })
    } else {
        process.stdout.write(`artifacts kept: vault=${tempVault} appSupport=${tempAppSupport}\n`)
    }

    const exitCode = failedCount > 0 || timedOutCount > 0 ? 1 : 0
    process.exit(exitCode)
}

void main().catch((err: unknown) => {
    process.stderr.write(`[perf] fatal: ${(err as Error).message}\n`)
    if (err instanceof Error && err.stack) process.stderr.write(err.stack + '\n')
    process.exit(1)
})

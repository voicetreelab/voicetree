/**
 * Pure helpers + small impure utilities used by electron-agent-storm-perf.spec.ts.
 *
 * Kept as functions, not classes — the spec composes these at the edge.
 */
import * as path from 'node:path'
import * as os from 'node:os'
import {
    existsSync,
    readFileSync,
    readdirSync,
    statSync,
} from 'node:fs'
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const require = createRequire(import.meta.url)

// ─── Args ────────────────────────────────────────────────────────────────

export interface E2EArgs {
    readonly agents: number
    readonly nodesPerAgent: number
    readonly vaultSeedNodeCount: number
    readonly perAgentTimeoutMs: number
    readonly globalTimeoutMs: number
    readonly keepArtifacts: boolean
}

function intEnv(key: string, fallback: number): number {
    const raw = process.env[key]
    if (raw === undefined || raw === '') return fallback
    const n = Number.parseInt(raw, 10)
    if (!Number.isInteger(n) || n < 0) throw new Error(`bad env ${key}=${raw}`)
    return n
}

function boolEnv(key: string): boolean {
    const raw = process.env[key]
    return raw === '1' || raw === 'true'
}

export function parseArgs(): E2EArgs {
    return {
        agents: intEnv('PERF_E2E_AGENTS', 8),
        nodesPerAgent: intEnv('PERF_E2E_NODES_PER_AGENT', 30),
        vaultSeedNodeCount: intEnv('PERF_E2E_VAULT_SEED_NODES', 300),
        perAgentTimeoutMs: intEnv('PERF_E2E_PER_AGENT_TIMEOUT_MS', 120_000),
        globalTimeoutMs: intEnv('PERF_E2E_GLOBAL_TIMEOUT_MS', 10 * 60_000),
        keepArtifacts: boolEnv('PERF_E2E_KEEP_ARTIFACTS'),
    }
}

// ─── Span / report helpers (mirrored from agent-storm.ts so the e2e and
// daemon-only reports stay shape-compatible) ──────────────────────────────

export interface SpanRecord {
    readonly traceId: string
    readonly spanId: string
    readonly name: string
    readonly durationMs: number
    readonly attributes?: Record<string, unknown>
}

export interface SpanSummary {
    readonly totalNew: number
    readonly byName: Record<string, number>
    readonly byOutcome: Record<string, number>
    readonly durationsMs: Record<string, { p50: number; p95: number; p99: number; max: number }>
}

export function ndjsonFileSize(filePath: string): number {
    try { return statSync(filePath).size } catch { return 0 }
}

export function readNdjsonTail(filePath: string, fromByteOffset: number): SpanRecord[] {
    if (!existsSync(filePath)) return []
    const buf = readFileSync(filePath)
    if (buf.length <= fromByteOffset) return []
    const tail = buf.subarray(fromByteOffset).toString('utf8')
    const out: SpanRecord[] = []
    for (const line of tail.split('\n')) {
        const trimmed = line.trim()
        if (trimmed.length === 0) continue
        try {
            out.push(JSON.parse(trimmed) as SpanRecord)
        } catch {
            // skip mid-write torn lines
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
    return sorted[lo] * (1 - (pos - lo)) + sorted[hi] * (pos - lo)
}

export function summarizeSpans(spans: readonly SpanRecord[]): SpanSummary {
    const byName: Record<string, number> = {}
    const byOutcome: Record<string, number> = {}
    const durationsByName: Record<string, number[]> = {}
    for (const span of spans) {
        byName[span.name] = (byName[span.name] ?? 0) + 1
        const outcome = span.attributes?.outcome
        if (typeof outcome === 'string') {
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

export function countMarkdownFiles(dir: string): number {
    let count = 0
    const walk = (d: string): void => {
        let entries: readonly string[]
        try { entries = readdirSync(d) } catch { return }
        for (const entry of entries) {
            if (entry.startsWith('.')) continue
            const full = path.join(d, entry)
            let stat
            try { stat = statSync(full) } catch { continue }
            if (stat.isDirectory()) walk(full)
            else if (stat.isFile() && entry.endsWith('.md')) count++
        }
    }
    walk(dir)
    return count
}

// ─── Fake-agent spawn helpers ────────────────────────────────────────────

export function buildFakeAgentScript(nodesPerAgent: number): object {
    const actions: object[] = []
    for (let i = 0; i < nodesPerAgent; i++) {
        actions.push({
            type: 'create_node',
            title: `Perf E2E Node ${i}`,
            summary: `Synthetic node ${i} produced by e2e perf-agent-storm.`,
            content: `Node body for index ${i}. Generated by the e2e perf harness.`,
        })
    }
    actions.push({ type: 'exit', code: 0 })
    return { actions }
}

export function buildAgentPrompt(script: object): string {
    return `### FAKE_AGENT_SCRIPT ###\n${JSON.stringify(script)}\n### END_FAKE_AGENT_SCRIPT ###`
}

// webapp/e2e-tests/.../perf/perf-helpers/agentStormE2eHelpers.ts
// → ../../../../../.. is the worktree root
function resolveRepoRoot(): string {
    return path.resolve(__dirname, '..', '..', '..', '..', '..', '..', '..')
}

export function resolveFakeAgentEntrypoint(): { dir: string; entry: string } {
    const repoRoot = resolveRepoRoot()
    const dir = path.join(repoRoot, 'tools', 'vt-fake-agent')
    const entry = path.join(dir, 'src', 'index.ts')
    if (!existsSync(entry)) throw new Error(`vt-fake-agent entrypoint not found at ${entry}`)
    return { dir, entry }
}

export function resolveTsxImportPath(): string {
    return require.resolve('tsx')
}

// ─── MCP port discovery from .mcp.json (prod-shape contract) ─────────────

export async function readMcpPort(mcpJsonPath: string, timeoutMs: number): Promise<number> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        if (existsSync(mcpJsonPath)) {
            try {
                const raw = readFileSync(mcpJsonPath, 'utf8')
                const parsed = JSON.parse(raw) as { mcpServers?: Record<string, { url?: string }> }
                const url = parsed.mcpServers?.voicetree?.url
                if (typeof url === 'string') {
                    const m = url.match(/:(\d+)\/mcp$/)
                    if (m) return Number.parseInt(m[1], 10)
                }
            } catch {
                // file mid-write; try again
            }
        }
        await new Promise(r => setTimeout(r, 250))
    }
    throw new Error(`timed out waiting for ${mcpJsonPath} with mcpServers.voicetree.url`)
}

// ─── graph-db-server native binding check (mirrors realistic-perf spec) ───

function canLoadNativeGraphDbModules(nodeBin: string, projectRoot: string): boolean {
    try {
        execFileSync(nodeBin, ['-e', "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(':memory:').close()"], {
            cwd: path.resolve(projectRoot, '..'),
            stdio: 'ignore',
        })
        return true
    } catch {
        return false
    }
}

export function resolveGraphDaemonNodeBin(projectRoot: string): string {
    const nvmNodeBin = path.join(os.homedir(), '.nvm', 'versions', 'node', 'v22.20.0', 'bin', 'node')
    const candidates = [
        process.env.VT_GRAPHD_NODE_BIN,
        process.env.npm_node_execpath,
        process.execPath,
        existsSync(nvmNodeBin) ? nvmNodeBin : undefined,
        'node',
    ].filter((c): c is string => Boolean(c))
    return candidates.find(bin => canLoadNativeGraphDbModules(bin, projectRoot)) ?? process.execPath
}

// ─── Agent results + per-agent exit waiter ───────────────────────────────

export interface AgentResult {
    readonly terminalId: string
    readonly spawnSuccess: boolean
    readonly startedAtMs: number
    readonly exitedAtMs: number | null
    readonly exitCode: number | null
    readonly stdoutSnippet: string
    readonly errorMessage?: string
}

export async function waitForExit(
    terminalId: string,
    exitedTerminals: Map<string, { code: number; atMs: number }>,
    getTerminalStatus: (id: string) => 'exited' | string | undefined,
    timeoutMs: number,
): Promise<{ code: number; atMs: number } | null> {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
        const found = exitedTerminals.get(terminalId)
        if (found) return found
        if (getTerminalStatus(terminalId) === 'exited') {
            const entry = { code: 0, atMs: Date.now() }
            exitedTerminals.set(terminalId, entry)
            return entry
        }
        await new Promise(r => setTimeout(r, 250))
    }
    return null
}

// ─── User-data seeding (projects.json + voicetree-config.json) ──────────

export async function seedUserData(
    fs: typeof import('node:fs/promises'),
    appSupportPath: string,
    vaultPath: string,
): Promise<void> {
    const projectName = path.basename(path.dirname(vaultPath))
    await fs.writeFile(
        path.join(appSupportPath, 'projects.json'),
        JSON.stringify([{
            id: 'e2e-storm-perf-project',
            path: path.dirname(vaultPath),
            name: projectName,
            type: 'folder',
            lastOpened: Date.now(),
            voicetreeInitialized: true,
        }], null, 2),
        'utf8',
    )
    await fs.writeFile(
        path.join(appSupportPath, 'voicetree-config.json'),
        JSON.stringify({
            lastDirectory: path.dirname(vaultPath),
            vaultConfig: {
                [path.dirname(vaultPath)]: { writePath: vaultPath, readPaths: [] },
            },
        }, null, 2),
        'utf8',
    )
}

// ─── Console summary printer ─────────────────────────────────────────────

export interface PrintStormSummaryInput {
    readonly args: E2EArgs
    readonly completedCount: number
    readonly failedCount: number
    readonly timedOutCount: number
    readonly wallMs: number
    readonly filesCreated: number
    readonly graphdSummary: SpanSummary
    readonly electronSummary: SpanSummary
    readonly rendererSummary: SpanSummary
    readonly heapBeforeBytes: number
    readonly heapAfterBytes: number
    readonly reportPath: string
    readonly mainProfilePath: string
    readonly rendererProfilePath: string
}

export function printStormSummary(s: PrintStormSummaryInput): void {
    const sep = '='.repeat(70)
    console.log(`\n${sep}`)
    console.log('  E2E AGENT-STORM PERF — SUMMARY')
    console.log(sep)
    console.log(`  agents:        ${s.args.agents} requested, ${s.completedCount} ok, ${s.failedCount} failed, ${s.timedOutCount} timed out`)
    console.log(`  nodes/agent:   ${s.args.nodesPerAgent}`)
    console.log(`  wall time:     ${s.wallMs}ms`)
    console.log(`  files written: ${s.filesCreated} (${(s.filesCreated / Math.max(1, s.wallMs / 1000)).toFixed(1)}/sec)`)
    printSpanGroup('vt-graphd', s.graphdSummary)
    printSpanGroup('vt-electron-daemon', s.electronSummary)
    printSpanGroup('vt-renderer', s.rendererSummary)
    if (s.rendererSummary.totalNew === 0) {
        console.log('    (renderer tracer not yet implemented — see RENDERER SPAN SPEC at top of file)')
    }
    console.log(`  renderer JS heap (after):        ${(s.heapAfterBytes / 1024 / 1024).toFixed(1)} MB (delta ${((s.heapAfterBytes - s.heapBeforeBytes) / 1024 / 1024).toFixed(1)} MB)`)
    console.log(`  report:        ${s.reportPath}`)
    console.log(`  cpuprofiles:   ${s.mainProfilePath}\n                 ${s.rendererProfilePath}`)
    console.log(sep)
}

function printSpanGroup(label: string, summary: SpanSummary): void {
    console.log(`  ${label} spans (new):           ${summary.totalNew}`)
    for (const [name, n] of Object.entries(summary.byName).sort()) {
        const d = summary.durationsMs[name]
        console.log(`    ${name.padEnd(40)}  n=${String(n).padStart(5)}  p50=${d.p50.toFixed(1)}ms  p95=${d.p95.toFixed(1)}ms  max=${d.max.toFixed(1)}ms`)
    }
}

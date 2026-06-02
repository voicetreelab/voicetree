// Helpers for electron-agent-storm-perf.spec.ts.
//
// Extracted to keep the spec file under the 500-line cap. Each export is a
// pure(-ish) function over its arguments — no module-level state; the spec
// passes paths and args through explicitly. The two side-effectful exports
// (countMarkdownFiles, readDaemonUrl) take their target as an argument.

import type { Page } from '@playwright/test'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import * as path from 'node:path'
import * as os from 'node:os'

// ─── Argument parsing ────────────────────────────────────────────────────

export interface E2EArgs {
    readonly agents: number
    readonly nodesPerAgent: number
    readonly projectSeedNodeCount: number
    readonly perAgentTimeoutMs: number
    readonly globalTimeoutMs: number
    readonly keepArtifacts: boolean
}

export function intEnv(key: string, fallback: number): number {
    const raw = process.env[key]
    if (raw === undefined || raw === '') return fallback
    const n = Number.parseInt(raw, 10)
    if (!Number.isInteger(n) || n < 0) throw new Error(`bad env ${key}=${raw}`)
    return n
}

export function boolEnv(key: string): boolean {
    const raw = process.env[key]
    return raw === '1' || raw === 'true'
}

export function parseStormArgs(): E2EArgs {
    return {
        agents: intEnv('PERF_E2E_AGENTS', 8),
        nodesPerAgent: intEnv('PERF_E2E_NODES_PER_AGENT', 30),
        projectSeedNodeCount: intEnv('PERF_E2E_PROJECT_SEED_NODES', 300),
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

// ─── Fake-agent script + prompt builders ─────────────────────────────────

export function buildFakeAgentScript(nodesPerAgent: number): object {
    const actions: object[] = []
    for (let i = 0; i < nodesPerAgent; i++) {
        // Must match the fake-agent executor's Action contract:
        // `create_nodes` with a `nodes[]`. The older singular `create_node`
        // was silently rejected as "Unknown action type" → zero nodes created.
        actions.push({
            type: 'create_nodes',
            nodes: [{
                title: `Perf E2E Node ${i}`,
                summary: `Synthetic node ${i} produced by e2e perf-agent-storm.`,
                content: `Node body for index ${i}. Generated by the e2e perf harness.`,
            }],
        })
    }
    actions.push({ type: 'exit', code: 0 })
    return { actions }
}

export function buildAgentPrompt(script: object): string {
    return `### FAKE_AGENT_SCRIPT ###\n${JSON.stringify(script)}\n### END_FAKE_AGENT_SCRIPT ###`
}

// ─── Path resolution ─────────────────────────────────────────────────────

export function resolveRepoRoot(specDir: string): string {
    // webapp/e2e-tests/.../perf/electron-agent-storm-perf.spec.ts
    // → ../../../../.. is the worktree root (caller supplies __dirname for that spec).
    return path.resolve(specDir, '..', '..', '..', '..', '..', '..')
}

export function resolveFakeAgentEntrypoint(specDir: string): { dir: string; entry: string } {
    const repoRoot = resolveRepoRoot(specDir)
    const dir = path.join(repoRoot, 'tools', 'vt-fake-agent')
    const entry = path.join(dir, 'src', 'index.ts')
    if (!existsSync(entry)) throw new Error(`vt-fake-agent entrypoint not found at ${entry}`)
    return { dir, entry }
}

// ─── Daemon URL discovery from the renderer accessor ─────────────────────

export async function readDaemonUrl(appWindow: Page, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs
    let lastErr: unknown
    while (Date.now() < deadline) {
        try {
            const url: string = await appWindow.evaluate(async () => {
                const api = (window as unknown as { electronAPI?: { main: { getDaemonUrl: () => Promise<string> } } }).electronAPI
                if (!api) throw new Error('electronAPI not available')
                return await api.main.getDaemonUrl()
            })
            if (url) return url
        } catch (err) {
            lastErr = err
        }
        await new Promise(r => setTimeout(r, 250))
    }
    throw new Error(`timed out waiting for daemon URL${lastErr ? `: ${String(lastErr)}` : ''}`)
}

// ─── graph-db-server native binding check ─────────────────────────────────

function canLoadNativeGraphDbModules(nodeBin: string, cwd: string): boolean {
    try {
        execFileSync(nodeBin, ['-e', "const { DatabaseSync } = require('node:sqlite'); new DatabaseSync(':memory:').close()"], {
            cwd,
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
    const cwd = path.resolve(projectRoot, '..')
    return candidates.find((bin) => canLoadNativeGraphDbModules(bin, cwd)) ?? process.execPath
}

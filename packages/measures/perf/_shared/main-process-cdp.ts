/**
 * Electron CPU profiler via Chrome DevTools Protocol.
 *
 * Connects to a Node `--inspect=<port>` debugger via the V8 Inspector WebSocket
 * (CDP), drives the `Profiler` domain to capture a sampling CPU profile, and
 * returns a `.cpuprofile`-shaped JSON object that opens in:
 *   - Chrome DevTools (Performance tab — drag & drop)
 *   - VS Code (click to open)
 *   - https://www.speedscope.app
 *
 * Consumers as of this writing:
 *   - `webapp/e2e-tests/.../perf/electron-500-node-cdp-perf.spec.ts`
 *     (Playwright-driven; passes the inspect port captured via Playwright's
 *     own stderr pipe)
 *   - `packages/measures/perf/electron-main-storm.ts`
 *     (raw `child_process.spawn`; captures main and renderer profiles)
 *
 * The helper is deliberately Playwright-free so it can be used from either.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import * as http from 'node:http'
import * as path from 'node:path'
import WebSocket from 'ws'

// ============================================================================
// CDP-over-WebSocket connection
// ============================================================================

interface CdpResponse {
    id: number
    result?: Record<string, unknown>
    error?: { message: string }
}

interface CdpTarget {
    type?: string
    title?: string
    url?: string
    webSocketDebuggerUrl?: string
}

/**
 * Thin per-connection CDP client. Each handle owns one WebSocket and one
 * pending-request map — no module-level state, so concurrent profilers in the
 * same process don't collide.
 */
export interface MainProcessCdpHandle {
    send(method: string, params?: Record<string, unknown>): Promise<CdpResponse>
    close(): void
}

function makeHandle(ws: WebSocket): MainProcessCdpHandle {
    let msgId = 0
    const pending = new Map<number, { resolve: (v: CdpResponse) => void; reject: (e: Error) => void }>()
    ws.on('message', (data: WebSocket.Data) => {
        const msg = JSON.parse(data.toString()) as CdpResponse
        const p = pending.get(msg.id)
        if (p) {
            pending.delete(msg.id)
            p.resolve(msg)
        }
    })
    return {
        async send(method, params) {
            const id = ++msgId
            return new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject })
                ws.send(JSON.stringify({ id, method, params }))
            })
        },
        close() { ws.close() },
    }
}

async function discoverInspectorWsUrl(inspectPort: number): Promise<string> {
    return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${inspectPort}/json/list`, (res) => {
            let data = ''
            res.on('data', (chunk: string) => { data += chunk })
            res.on('end', () => {
                try {
                    const targets = JSON.parse(data) as Array<{ webSocketDebuggerUrl?: string }>
                    const wsUrl = targets[0]?.webSocketDebuggerUrl
                    if (wsUrl) resolve(wsUrl)
                    else reject(new Error(`no debugger target on port ${inspectPort}`))
                } catch (err) {
                    reject(new Error(`/json/list parse failed: ${(err as Error).message}`))
                }
            })
        }).on('error', reject)
    })
}

async function fetchCdpTargets(debugPort: number, pathSuffix: string): Promise<readonly CdpTarget[]> {
    return new Promise((resolve, reject) => {
        http.get(`http://127.0.0.1:${debugPort}${pathSuffix}`, (res) => {
            let data = ''
            res.on('data', (chunk: string) => { data += chunk })
            res.on('end', () => {
                try {
                    const targets = JSON.parse(data) as CdpTarget[]
                    resolve(Array.isArray(targets) ? targets : [])
                } catch (err) {
                    reject(new Error(`${pathSuffix} parse failed: ${(err as Error).message}`))
                }
            })
        }).on('error', reject)
    })
}

export function selectInspectablePageTarget(targets: readonly CdpTarget[]): CdpTarget | undefined {
    return targets.find((target) =>
        target.type === 'page'
        && typeof target.webSocketDebuggerUrl === 'string'
        && target.webSocketDebuggerUrl.length > 0
        && target.url !== 'devtools://devtools/bundled/inspector.html',
    )
}

async function discoverRendererWsUrl(debugPort: number, timeoutMs: number): Promise<string> {
    const deadline = Date.now() + timeoutMs
    let lastError: Error | undefined

    while (Date.now() < deadline) {
        try {
            const target = selectInspectablePageTarget(await fetchCdpTargets(debugPort, '/json'))
            if (target?.webSocketDebuggerUrl) return target.webSocketDebuggerUrl
        } catch (err) {
            lastError = err as Error
        }
        await new Promise((r) => setTimeout(r, 200))
    }

    throw new Error(
        `no inspectable renderer page target on remote debugging port ${debugPort}`
        + (lastError ? ` (${lastError.message})` : ''),
    )
}

async function connectAndStartProfiler(wsUrl: string): Promise<MainProcessCdpHandle> {
    const ws = await new Promise<WebSocket>((resolve, reject) => {
        const w = new WebSocket(wsUrl)
        w.on('open', () => resolve(w))
        w.on('error', reject)
    })
    const handle = makeHandle(ws)
    await handle.send('Profiler.enable')
    await handle.send('Profiler.start')
    return handle
}

async function stopProfileAndSave(
    handle: MainProcessCdpHandle,
    outputDir: string,
    filename: string,
): Promise<string> {
    const response = await handle.send('Profiler.stop')
    handle.close()
    const profile = response.result?.profile
    if (!profile) throw new Error(`Profiler.stop returned no profile (${response.error?.message ?? 'unknown'})`)
    const profileJson = JSON.stringify(profile, null, 2)
    await mkdir(outputDir, { recursive: true })
    const filepath = path.join(outputDir, filename)
    await writeFile(filepath, profileJson, 'utf8')
    return filepath
}

// ============================================================================
// Public API — profiler lifecycle
// ============================================================================

/**
 * Open a CDP connection to the inspector and start `Profiler.start`. Returns a
 * handle the caller passes to `stopMainProcessProfileAndSave`.
 */
export async function startMainProcessProfile(inspectPort: number): Promise<MainProcessCdpHandle> {
    const wsUrl = await discoverInspectorWsUrl(inspectPort)
    return connectAndStartProfiler(wsUrl)
}

export async function startRendererProcessProfile(
    remoteDebugPort: number,
    timeoutMs: number,
): Promise<MainProcessCdpHandle> {
    const wsUrl = await discoverRendererWsUrl(remoteDebugPort, timeoutMs)
    return connectAndStartProfiler(wsUrl)
}

export async function stopMainProcessProfileAndSave(
    handle: MainProcessCdpHandle,
    outputDir: string,
    filename: string,
): Promise<string> {
    return stopProfileAndSave(handle, outputDir, filename)
}

export async function stopRendererProcessProfileAndSave(
    handle: MainProcessCdpHandle,
    outputDir: string,
    filename: string,
): Promise<string> {
    return stopProfileAndSave(handle, outputDir, filename)
}

// ============================================================================
// .cpuprofile analysis — pure
// ============================================================================

interface CpuProfileNode {
    id: number
    callFrame: {
        functionName: string
        scriptId: string
        url: string
        lineNumber: number
        columnNumber: number
    }
    hitCount: number
    children?: number[]
}

interface CpuProfile {
    nodes: CpuProfileNode[]
    startTime: number
    endTime: number
    samples: number[]
    timeDeltas: number[]
}

export interface MainProcessMetrics {
    totalDurationMs: number
    totalSamples: number
    activeSamples: number
    topFunctions: Array<{
        name: string
        url: string
        line: number
        selfSamples: number
        selfPercent: number
    }>
}

export function analyzeMainProcessProfile(profileJson: string): MainProcessMetrics {
    const profile = JSON.parse(profileJson) as CpuProfile
    const totalDurationMs = (profile.endTime - profile.startTime) / 1000
    const totalSamples = profile.samples.length

    const nodeMap = new Map<number, CpuProfileNode>()
    for (const node of profile.nodes) nodeMap.set(node.id, node)

    const sampleCounts = new Map<number, number>()
    for (const sampleId of profile.samples) {
        sampleCounts.set(sampleId, (sampleCounts.get(sampleId) ?? 0) + 1)
    }

    const funcKey = (n: CpuProfileNode): string =>
        `${n.callFrame.functionName}|${n.callFrame.url}|${n.callFrame.lineNumber}`

    const funcSamples = new Map<string, { node: CpuProfileNode; count: number }>()
    for (const [nodeId, count] of sampleCounts) {
        const node = nodeMap.get(nodeId)
        if (!node) continue
        const fn = node.callFrame.functionName
        if (fn === '(idle)' || fn === '(program)' || fn === '(garbage collector)') continue
        const key = funcKey(node)
        const existing = funcSamples.get(key)
        if (existing) existing.count += count
        else funcSamples.set(key, { node, count })
    }

    const sorted = Array.from(funcSamples.values()).sort((a, b) => b.count - a.count)
    const activeSamples = sorted.reduce((sum, e) => sum + e.count, 0)

    const topFunctions = sorted.slice(0, 50).map((entry) => ({
        name: entry.node.callFrame.functionName || '(anonymous)',
        url: entry.node.callFrame.url,
        line: entry.node.callFrame.lineNumber,
        selfSamples: entry.count,
        selfPercent: activeSamples > 0 ? (entry.count / activeSamples) * 100 : 0,
    }))

    return { totalDurationMs, totalSamples, activeSamples, topFunctions }
}

export function printMainProcessMetrics(metrics: MainProcessMetrics): void {
    const divider = '='.repeat(90)
    process.stdout.write(`\n${divider}\n`)
    process.stdout.write('  MAIN PROCESS CPU PROFILE\n')
    process.stdout.write(`  Duration: ${(metrics.totalDurationMs / 1000).toFixed(2)}s | Samples: ${metrics.totalSamples}\n`)
    process.stdout.write(`${divider}\n`)
    process.stdout.write(
        'Samples'.padStart(10)
        + '%Self'.padStart(8)
        + '  ' + 'Function'.padEnd(40)
        + '  Source\n',
    )
    process.stdout.write(`${'-'.repeat(90)}\n`)
    for (const fn of metrics.topFunctions) {
        const url = fn.url
        const shortUrl = url.includes('/') ? url.split('/').slice(-3).join('/') : url
        const source = shortUrl ? `${shortUrl}:${fn.line}` : '(native)'
        const isAppCode = url && !url.includes('node_modules') && !url.startsWith('node:')
        process.stdout.write(
            String(fn.selfSamples).padStart(10)
            + (fn.selfPercent.toFixed(1) + '%').padStart(8)
            + '  ' + (isAppCode ? '>>> ' : '    ') + fn.name.substring(0, 36).padEnd(36)
            + '  ' + source.substring(0, 50) + '\n',
        )
    }
    process.stdout.write(`${divider}\n`)
}

/**
 * Process-observation machinery for the e2e-storm-mvp: CDP-driven metric
 * sampling, CPU-profile capture, and renderer screenshot sampling.
 *
 * Extracted from index.ts. Each `start*` function owns one long-lived sampler
 * and returns a `stop`/teardown closure — the impurity (CDP sessions, OTel
 * meters, fs writes, Pyroscope uploads) is concentrated behind those handles
 * so the orchestrator only deals in start/stop.
 *
 * The renderer screenshot sampler shoots every `intervalMs` (default 5s) plus
 * an initial and a final frame, each validated non-blank by `pngLooksNonBlank`.
 */
import type { Page } from '@playwright/test'
import * as path from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

import type { MainProcessCdpHandle } from '../_shared/main-process-cdp.ts'
import { createOtelMetricSink } from './otelMetricSink.ts'
import { uploadV8CpuProfileToPyroscope } from './pyroscopeProfile.ts'
import type { RunContext } from './runConfig.ts'

export type RendererProfileCapture = {
    readonly stop: () => Promise<void>
}

export type RendererScreenshotCapture = {
    readonly dir: string
    readonly stop: () => Promise<void>
}

interface MainProcessSnapshot {
    readonly cpu: {
        readonly user: number
        readonly system: number
    }
    readonly memory: {
        readonly rss: number
        readonly heapUsed: number
        readonly heapTotal: number
        readonly external: number
        readonly arrayBuffers: number
    }
}

async function readMainProcessSnapshot(handle: MainProcessCdpHandle): Promise<MainProcessSnapshot> {
    const response = await handle.send('Runtime.evaluate', {
        expression: 'JSON.stringify({ cpu: process.cpuUsage(), memory: process.memoryUsage() })',
        returnByValue: true,
    })
    const value = response.result?.result
    if (!value || typeof value !== 'object' || !('value' in value) || typeof value.value !== 'string') {
        throw new Error(`Runtime.evaluate returned no process snapshot (${response.error?.message ?? 'unknown'})`)
    }
    return JSON.parse(value.value) as MainProcessSnapshot
}

export async function startMainProcessMetricsSampler(
    handle: MainProcessCdpHandle,
    env: { readonly otlpEndpoint?: string; readonly instanceId?: string },
): Promise<() => Promise<void>> {
    const managedMeter = createOtelMetricSink({
        serviceName: 'vt-electron-main',
        meterName: 'vt-e2e-storm-mvp',
        otlpEndpoint: env.otlpEndpoint,
        instanceId: env.instanceId,
    })
    const meter = managedMeter.meter
    const cpuCounter = meter.createCounter('process.cpu.time', {
        description: 'Electron main CPU time consumed between e2e-storm CDP samples.',
        unit: 's',
    })
    let latestSnapshot: MainProcessSnapshot | null = null
    meter.createObservableGauge('process.memory.usage', {
        description: 'Electron main memory usage sampled via CDP Runtime.evaluate.',
        unit: 'By',
    }).addCallback((result) => {
        const memory = latestSnapshot?.memory
        if (!memory) return
        result.observe(memory.rss, { type: 'rss' })
        result.observe(memory.heapUsed, { type: 'heap_used' })
        result.observe(memory.heapTotal, { type: 'heap_total' })
        result.observe(memory.external, { type: 'external' })
        result.observe(memory.arrayBuffers, { type: 'array_buffers' })
    })

    let previousCpu = (await readMainProcessSnapshot(handle)).cpu
    let stopped = false

    const writeRow = async (): Promise<void> => {
        if (stopped) return
        const snapshot = await readMainProcessSnapshot(handle)
        cpuCounter.add((snapshot.cpu.user - previousCpu.user) / 1_000_000, { type: 'user' })
        cpuCounter.add((snapshot.cpu.system - previousCpu.system) / 1_000_000, { type: 'system' })
        previousCpu = snapshot.cpu
        latestSnapshot = snapshot
    }

    const interval = setInterval(() => {
        void writeRow().catch((error: unknown) => {
            process.stderr.write(`[mvp] electron-main metrics sample failed: ${(error as Error).message}\n`)
        })
    }, 1000)
    interval.unref()

    return async () => {
        if (stopped) return
        clearInterval(interval)
        await writeRow()
        stopped = true
        await managedMeter.forceFlush()
        await managedMeter.shutdown()
    }
}

interface RendererCdpHandle {
    send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
    detach(): Promise<void>
}

type RendererMetric = {
    readonly name: string
    readonly value: number
}

function rendererMetricValue(metrics: readonly RendererMetric[], name: string): number | undefined {
    return metrics.find(metric => metric.name === name)?.value
}

function pngLooksNonBlank(buffer: Buffer): boolean {
    if (buffer.subarray(0, 8).compare(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) !== 0) return false
    let offset = 8
    let width = 0
    let height = 0
    let colorType = 0
    const idat: Buffer[] = []

    while (offset + 12 <= buffer.length) {
        const length = buffer.readUInt32BE(offset)
        const type = buffer.subarray(offset + 4, offset + 8).toString('ascii')
        const data = buffer.subarray(offset + 8, offset + 8 + length)
        offset += 12 + length

        if (type === 'IHDR') {
            width = data.readUInt32BE(0)
            height = data.readUInt32BE(4)
            const bitDepth = data[8]
            colorType = data[9] ?? 0
            if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) return false
        } else if (type === 'IDAT') {
            idat.push(data)
        } else if (type === 'IEND') {
            break
        }
    }

    if (width === 0 || height === 0 || idat.length === 0) return false
    const bytesPerPixel = colorType === 6 ? 4 : 3
    const rowBytes = width * bytesPerPixel
    const inflated = inflateSync(Buffer.concat(idat))
    let read = 0
    let previous = Buffer.alloc(rowBytes)
    let darkest = 255
    let brightest = 0
    let sampled = 0

    for (let y = 0; y < height; y++) {
        const filter = inflated[read++] ?? 0
        const row = Buffer.from(inflated.subarray(read, read + rowBytes))
        read += rowBytes

        for (let x = 0; x < rowBytes; x++) {
            const left = x >= bytesPerPixel ? row[x - bytesPerPixel] ?? 0 : 0
            const up = previous[x] ?? 0
            const upLeft = x >= bytesPerPixel ? previous[x - bytesPerPixel] ?? 0 : 0
            const p = left + up - upLeft
            const pa = Math.abs(p - left)
            const pb = Math.abs(p - up)
            const pc = Math.abs(p - upLeft)
            const paeth = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
            const predictor =
                filter === 1 ? left
                    : filter === 2 ? up
                        : filter === 3 ? Math.floor((left + up) / 2)
                            : filter === 4 ? paeth
                                : 0
            row[x] = ((row[x] ?? 0) + predictor) & 0xff
        }

        const stride = Math.max(1, Math.floor(width / 32))
        for (let x = 0; x < width; x += stride) {
            const i = x * bytesPerPixel
            const luminance = Math.round(
                ((row[i] ?? 0) * 0.2126) + ((row[i + 1] ?? 0) * 0.7152) + ((row[i + 2] ?? 0) * 0.0722),
            )
            darkest = Math.min(darkest, luminance)
            brightest = Math.max(brightest, luminance)
            sampled += 1
        }
        previous = row
    }

    return sampled > 0 && brightest > 20 && (brightest - darkest) > 10
}

async function focusTerminalForScreenshot(appWindow: Page): Promise<void> {
    const hasTerminalWindow = await appWindow.evaluate(() => (
        document.querySelector('.cy-floating-window-terminal') !== null
    ))
    if (!hasTerminalWindow) return

    await appWindow.keyboard.press('Meta+]')
    await appWindow.waitForTimeout(350)
    await appWindow.evaluate(() => {
        const cy = (window as unknown as {
            cytoscapeInstance?: {
                getElementById: (id: string) => { length: number }
                fit: (eles: unknown, padding?: number) => void
            }
        }).cytoscapeInstance
        if (!cy) return

        const terminals = Array.from(document.querySelectorAll<HTMLElement>('.cy-floating-window-terminal'))
        const terminal = terminals.find(el => el.querySelector('.xterm')) ?? terminals.at(-1)
        const shadowNodeId = terminal?.dataset.shadowNodeId
        if (!shadowNodeId) return

        const shadowNode = cy.getElementById(shadowNodeId)
        if (shadowNode.length > 0) cy.fit(shadowNode, 180)
    })
    await appWindow.waitForTimeout(350)
}

export async function startRendererProfileCapture(
    appWindow: Page,
    runContext: RunContext,
): Promise<RendererProfileCapture> {
    const cdp = await appWindow.context().newCDPSession(appWindow) as RendererCdpHandle
    const managedMeter = createOtelMetricSink({
        serviceName: 'vt-renderer',
        meterName: 'vt-e2e-storm-mvp',
        otlpEndpoint: runContext.otlpEndpoint,
        instanceId: runContext.runUuid,
    })
    const profilesDir = path.join(runContext.runDir, 'profiles')
    mkdirSync(profilesDir, { recursive: true })
    let latestMetrics: readonly RendererMetric[] = []
    let stopped = false

    const meter = managedMeter.meter
    meter.createObservableGauge('process.memory.usage', {
        description: 'Renderer JavaScript heap memory sampled via CDP Performance.getMetrics.',
        unit: 'By',
    }).addCallback((result) => {
        result.observe(rendererMetricValue(latestMetrics, 'JSHeapUsedSize') ?? 0, { type: 'heap_used' })
        result.observe(rendererMetricValue(latestMetrics, 'JSHeapTotalSize') ?? 0, { type: 'heap_total' })
    })
    meter.createObservableGauge('browser.renderer.metric', {
        description: 'Renderer CDP Performance.getMetrics values for DOM and layout health.',
    }).addCallback((result) => {
        result.observe(rendererMetricValue(latestMetrics, 'Nodes') ?? 0, { metric: 'nodes' })
        result.observe(rendererMetricValue(latestMetrics, 'Documents') ?? 0, { metric: 'documents' })
        result.observe(rendererMetricValue(latestMetrics, 'LayoutCount') ?? 0, { metric: 'layout_count' })
        result.observe(rendererMetricValue(latestMetrics, 'RecalcStyleCount') ?? 0, { metric: 'recalc_style_count' })
        result.observe((rendererMetricValue(latestMetrics, 'LayoutDuration') ?? 0) * 1000, { metric: 'layout_duration_ms' })
        result.observe((rendererMetricValue(latestMetrics, 'RecalcStyleDuration') ?? 0) * 1000, { metric: 'recalc_style_duration_ms' })
        result.observe((rendererMetricValue(latestMetrics, 'ScriptDuration') ?? 0) * 1000, { metric: 'script_duration_ms' })
        result.observe((rendererMetricValue(latestMetrics, 'TaskDuration') ?? 0) * 1000, { metric: 'task_duration_ms' })
    })

    await cdp.send('Performance.enable')
    await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.start')

    const writeRow = async (): Promise<void> => {
        if (stopped) return
        const response = await cdp.send('Performance.getMetrics') as { readonly metrics?: readonly RendererMetric[] }
        latestMetrics = response.metrics ?? []
    }

    const interval = setInterval(() => {
        void writeRow().catch((error: unknown) => {
            process.stderr.write(`[mvp] renderer metrics sample failed: ${(error as Error).message}\n`)
        })
    }, 1000)
    interval.unref()

    return {
        stop: async () => {
            if (stopped) return
            clearInterval(interval)
            await writeRow()
            stopped = true
            const response = await cdp.send('Profiler.stop') as { readonly profile?: unknown }
            await cdp.send('Performance.disable').catch(() => undefined)
            await cdp.detach().catch(() => undefined)
            await managedMeter.forceFlush()
            await managedMeter.shutdown()
            if (!response.profile) throw new Error('Renderer Profiler.stop returned no profile')
            const cpuprofilePath = path.join(profilesDir, 'renderer.cpuprofile')
            writeFileSync(cpuprofilePath, JSON.stringify(response.profile), 'utf8')
            const upload = await uploadV8CpuProfileToPyroscope({
                cpuprofilePath,
                serviceName: 'vt-renderer',
                runUuid: runContext.runUuid,
                stoppedAtMs: Date.now(),
            })
            process.stdout.write(`[mvp] uploaded renderer profile to Pyroscope: ${upload.renderQuery}\n`)
        },
    }
}

export async function startRendererScreenshotCapture(
    appWindow: Page,
    runDir: string,
    intervalMs: number = 5_000,
): Promise<RendererScreenshotCapture> {
    const dir = path.join(runDir, 'screenshots')
    mkdirSync(dir, { recursive: true })
    let stopped = false
    let activeCapture: Promise<void> | null = null
    let index = 0

    const runCapture = async (reason: 'sample' | 'final'): Promise<void> => {
        const paddedIndex = String(index++).padStart(3, '0')
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const screenshotPath = path.join(dir, `renderer-${paddedIndex}-${reason}-${timestamp}.png`)
        await focusTerminalForScreenshot(appWindow).catch((error: unknown) => {
            process.stderr.write(`[mvp] terminal screenshot focus failed: ${(error as Error).message}\n`)
        })
        const bytes = await appWindow.screenshot({ path: screenshotPath, timeout: 5_000 })
        if (!pngLooksNonBlank(Buffer.from(bytes))) throw new Error(`blank renderer screenshot: ${screenshotPath}`)
        process.stdout.write(`[mvp] screenshot: ${screenshotPath}\n`)
    }

    const capture = async (reason: 'sample' | 'final'): Promise<void> => {
        if (activeCapture) {
            if (reason === 'sample') return
            await activeCapture
        }
        activeCapture = runCapture(reason).finally(() => {
            activeCapture = null
        })
        await activeCapture
    }

    void capture('sample').catch((error: unknown) => {
        process.stderr.write(`[mvp] initial renderer screenshot failed: ${(error as Error).message}\n`)
    })
    const interval = setInterval(() => {
        if (stopped) return
        void capture('sample').catch((error: unknown) => {
            process.stderr.write(`[mvp] renderer screenshot failed: ${(error as Error).message}\n`)
        })
    }, intervalMs)
    interval.unref()

    return {
        dir,
        stop: async () => {
            if (stopped) return
            stopped = true
            clearInterval(interval)
            await capture('final').catch((error: unknown) => {
                process.stderr.write(`[mvp] final renderer screenshot failed: ${(error as Error).message}\n`)
            })
        },
    }
}

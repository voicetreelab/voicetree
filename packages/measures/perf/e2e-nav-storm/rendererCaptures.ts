/**
 * Renderer artefact capture for e2e-nav-storm: a V8 CPU profile scoped to the
 * nav window (uploaded to Pyroscope) and periodic non-blank screenshots.
 *
 * The probe (`rendererPerfProbe.ts`) supplies the frame/longtask/INP MELTs; this
 * module adds the renderer `.cpuprofile` (so top renderer self-time frames are
 * attributable) and the screenshot evidence the validation bar requires to
 * prove the nav genuinely drove a visible, non-blank graph.
 *
 * Impure shell: CDP session, fs, clock, Playwright screenshot.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import * as path from 'node:path'
import type { Page } from '@playwright/test'
import { uploadV8CpuProfileToPyroscope } from '../e2e-storm-mvp/pyroscopeProfile.ts'
import { analyzeMainProcessProfile, type MainProcessMetrics } from '../_shared/main-process-cdp.ts'
import { pngLooksNonBlank } from '../_shared/pngNonBlank.ts'

interface RendererCdpHandle {
    send(method: string, params?: Record<string, unknown>): Promise<Record<string, unknown>>
    detach(): Promise<void>
}

export interface RendererCpuProfileCapture {
    readonly stop: () => Promise<{
        readonly cpuprofilePath: string
        readonly pyroscopeQuery: string
        readonly topFrames: MainProcessMetrics['topFunctions']
    }>
}

export async function startRendererCpuProfile(
    appWindow: Page,
    runUuid: string,
    runDir: string,
): Promise<RendererCpuProfileCapture> {
    const cdp = await appWindow.context().newCDPSession(appWindow) as unknown as RendererCdpHandle
    const profilesDir = path.join(runDir, 'profiles')
    mkdirSync(profilesDir, { recursive: true })

    await cdp.send('Profiler.setSamplingInterval', { interval: 100 })
    await cdp.send('Profiler.enable')
    await cdp.send('Profiler.start')

    let stopped = false
    return {
        stop: async () => {
            if (stopped) throw new Error('renderer cpu profile already stopped')
            stopped = true
            const response = await cdp.send('Profiler.stop') as { readonly profile?: unknown }
            await cdp.detach().catch(() => undefined)
            if (!response.profile) throw new Error('Renderer Profiler.stop returned no profile')
            const cpuprofilePath = path.join(profilesDir, 'renderer-nav.cpuprofile')
            const profileJson = JSON.stringify(response.profile)
            writeFileSync(cpuprofilePath, profileJson, 'utf8')
            const upload = await uploadV8CpuProfileToPyroscope({
                cpuprofilePath,
                serviceName: 'vt-renderer',
                runUuid,
                stoppedAtMs: Date.now(),
            })
            const analysis = analyzeMainProcessProfile(profileJson)
            return { cpuprofilePath, pyroscopeQuery: upload.renderQuery, topFrames: analysis.topFunctions }
        },
    }
}

export interface ScreenshotCapture {
    readonly dir: string
    readonly stop: () => Promise<{ readonly count: number; readonly nonBlank: number }>
}

/**
 * Periodically screenshot the page (graph in view — no terminal focus), each
 * validated as non-blank. Tracks how many passed the non-blank check so the
 * harness can fail honestly if the graph never rendered.
 */
export async function startScreenshots(
    appWindow: Page,
    runDir: string,
    intervalMs = 4000,
): Promise<ScreenshotCapture> {
    const dir = path.join(runDir, 'screenshots')
    mkdirSync(dir, { recursive: true })
    let index = 0
    let nonBlank = 0
    let stopped = false
    let active: Promise<void> | null = null

    const capture = async (reason: 'sample' | 'final'): Promise<void> => {
        const paddedIndex = String(index++).padStart(3, '0')
        const screenshotPath = path.join(dir, `nav-${paddedIndex}-${reason}.png`)
        const bytes = await appWindow.screenshot({ path: screenshotPath, timeout: 5000 })
        if (pngLooksNonBlank(Buffer.from(bytes))) nonBlank += 1
        else process.stderr.write(`[nav-storm] WARN blank screenshot: ${screenshotPath}\n`)
    }

    const safeCapture = (reason: 'sample' | 'final'): Promise<void> => {
        active = capture(reason).catch((error: unknown) => {
            process.stderr.write(`[nav-storm] screenshot failed: ${(error as Error).message}\n`)
        }).finally(() => { active = null })
        return active
    }

    await safeCapture('sample')
    const timer = setInterval(() => { if (!stopped && !active) void safeCapture('sample') }, intervalMs)
    timer.unref()

    return {
        dir,
        stop: async () => {
            stopped = true
            clearInterval(timer)
            if (active) await active
            await safeCapture('final')
            return { count: index, nonBlank }
        },
    }
}

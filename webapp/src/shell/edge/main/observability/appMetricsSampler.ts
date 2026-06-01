/**
 * Electron-main GPU/compositor CPU sampler.
 *
 * `app.getAppMetrics()` is the only in-process view of the GPU process's CPU
 * cost — the renderer's own profile and CDP `Performance.getMetrics` cannot see
 * it, and a headless run has no GPU process at all. This sampler periodically
 * reads per-process CPU and emits it as gauges through the EXISTING
 * observability meter (no parallel exporter), so a headful Mac run captures the
 * GPU(11%)+compositor cost the headless harness omits.
 *
 * `app.getAppMetrics` is injected so this module needs no `electron` import and
 * stays unit-testable. macOS `WindowServer` lives in a separate OS process that
 * `getAppMetrics` cannot reach — it is intentionally NOT wired here (documented
 * in the validation node), rather than faked.
 *
 * Gated by the caller (`main.ts`) to perf-probe runs with an OTLP endpoint.
 */
import { observabilityMetrics } from '@vt/observability'

/** Structural subset of Electron's `ProcessMetric` this sampler reads. */
export interface ProcessMetricLike {
    readonly pid: number
    readonly type: string
    readonly name?: string
    readonly serviceName?: string
    readonly cpu: { readonly percentCPUUsage: number }
}

export interface AppMetricsSamplerDeps {
    readonly getAppMetrics: () => readonly ProcessMetricLike[]
    readonly intervalMs?: number
    readonly meterName?: string
}

const DEFAULT_INTERVAL_MS = 1000

export interface AppMetricsSampler {
    readonly stop: () => void
}

/**
 * Start sampling per-process CPU into `process.cpu.usage_percent` gauges,
 * one series per process tagged `type` (e.g. `GPU`, `Browser`, `Tab`) and
 * `pid`. Returns a handle to stop the interval.
 */
export function startAppMetricsSampler(deps: AppMetricsSamplerDeps): AppMetricsSampler {
    const meter = observabilityMetrics.getMeter(deps.meterName ?? 'vt-electron-app-metrics')
    const cpuGauge = meter.createGauge('process.cpu.usage_percent', {
        description: 'Per-process CPU usage from Electron app.getAppMetrics(), incl. the GPU process.',
        unit: '%',
    })

    const sample = (): void => {
        for (const metric of deps.getAppMetrics()) {
            cpuGauge.record(metric.cpu.percentCPUUsage, {
                type: metric.type,
                pid: metric.pid,
                ...(metric.serviceName !== undefined ? { service_name: metric.serviceName } : {}),
                ...(metric.name !== undefined ? { process_name: metric.name } : {}),
            })
        }
    }

    sample()
    const timer = setInterval(sample, deps.intervalMs ?? DEFAULT_INTERVAL_MS)
    timer.unref?.()

    return { stop: () => clearInterval(timer) }
}

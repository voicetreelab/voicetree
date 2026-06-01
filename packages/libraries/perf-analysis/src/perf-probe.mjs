import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import { writeHeapSnapshot } from 'node:v8'

import { observabilityMetrics, tracing } from '@vt/observability'
import { createDurableLineLog } from './durable-line-log.mjs'

// Wall/CPU sampling is provided by @pyroscope/nodejs, which pulls @datadog/pprof
// — a native addon shipping node-ABI prebuilds only (no Electron build, and the
// npm package carries no sources to compile one). Importing it eagerly crashes
// Electron's main process at load. We therefore load it lazily and tolerantly:
// under Node it attaches; under Electron (or any runtime missing a matching
// prebuild) the import fails and we return null, so the probe runs the rest of
// its signals (metrics, log, heap snapshots) without wall profiling instead of
// taking down the host. This is what makes lite default-on safe in electron-main.
async function loadPyroscope() {
  try {
    const mod = await import('@pyroscope/nodejs')
    return mod.default ?? mod
  } catch {
    return null
  }
}

const RUN_ID_ENV = 'VOICETREE_RUN_INSTANCE_ID'
const OTLP_ENDPOINT_ENV = 'VOICETREE_OTLP_ENDPOINT'
const PERF_TIER_ENV = 'VOICETREE_PERF_TIER'
const PYROSCOPE_URL = 'http://localhost:2995'
const SAMPLE_INTERVAL_MS = 1_000
const HEAP_SNAPSHOT_OFFSETS_MS = [0, 5_000, 10_000]

// Wall/CPU sampling periods, in microseconds.
//   lite = 100 Hz (10 ms) — the conventional statistical-profiler rate, cheap
//          enough for always-on interactive use; ~100 samples/s/thread, which
//          over a minutes-long session is far more total signal than a bounded
//          storm window yet issues 10x fewer interrupts than `deep`.
//   deep = 1 kHz (1 ms)   — fine resolution for a bounded ~10s storm/deep run.
const LITE_WALL_SAMPLING_MICROS = 10_000
const DEEP_WALL_SAMPLING_MICROS = 1_000

const nsToMs = (value) => value / 1_000_000

/**
 * @typedef {'off' | 'lite' | 'deep'} PerfTier
 * @typedef {{ tier: 'off' }
 *         | { tier: 'lite' | 'deep', wallSamplingMicros: number, heapSnapshots: boolean }} PerfProbePlan
 */

// Pure, total: resolve the perf-probe execution plan from the environment.
// A single env var (`VOICETREE_PERF_TIER`) is the whole tier contract; any value
// that is not 'lite' or 'deep' (unset, '', 'off', garbage) yields the off plan.
// `lite` is the always-on-safe feature set; `deep` adds stop-the-world heap
// snapshots and a higher sampling rate for bounded captures.
/**
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {PerfProbePlan}
 */
export function perfProbePlan(env = process.env) {
  switch (env[PERF_TIER_ENV]) {
    case 'lite':
      return { tier: 'lite', wallSamplingMicros: LITE_WALL_SAMPLING_MICROS, heapSnapshots: false }
    case 'deep':
      return { tier: 'deep', wallSamplingMicros: DEEP_WALL_SAMPLING_MICROS, heapSnapshots: true }
    default:
      return { tier: 'off' }
  }
}

function appendTraceContext(message, traceContext) {
  if (!traceContext) return message
  return `${message} trace_id=${traceContext.traceId} span_id=${traceContext.spanId}`
}

function resolveRunUuid(env = process.env) {
  const existing = env[RUN_ID_ENV]
  if (existing && existing.length > 0) return existing

  const generated = randomUUID()
  env[RUN_ID_ENV] = generated
  return generated
}

function resolveRunDir(runUuid) {
  return join(homedir(), '.voicetree', 'perf', runUuid)
}

async function ensureRunDirs(runDir) {
  const paths = {
    heapSnapshotsDir: join(runDir, 'heap-snapshots'),
    logsDir: join(runDir, 'logs'),
  }
  await Promise.all(Object.values(paths).map((path) => mkdir(path, { recursive: true })))
  return paths
}

function createPlainLogWriter({ pyroscope, svc, logPath }) {
  const log = createDurableLineLog(logPath)

  const write = (level, message) => {
    log.writeLine(`${new Date().toISOString()} ${level} ${appendTraceContext(message, tracing.activeTraceContext())}`)
  }

  const writeInSpan = (spanName, level, message) => {
    tracing.syncSpan(spanName, (span) => {
      // Grafana 13's tracesToProfiles button keys off the presence of this
      // attribute on the span; the value is opaque to Grafana. We mirror the
      // span ID for manual trace→profile correlation.
      span.setAttribute('pyroscope.profile.id', tracing.activeTraceContext()?.spanId ?? '')
      const body = () => write(level, message)
      // wrapWithLabels tags concurrent wall-CPU samples with span_name so the
      // Grafana "Profiles for this span" pivot lands on operation-aggregated
      // CPU. Only when Pyroscope is loaded (Node runtime); tolerate calls before
      // Pyroscope.init() / after stopWallProfiling() so we don't crash during
      // startup/shutdown windows.
      if (pyroscope) {
        try {
          pyroscope.wrapWithLabels({ span_name: spanName }, body)
        } catch {
          body()
        }
      } else {
        body()
      }
    }, {
      'service.name': svc,
    })
  }

  writeInSpan('perf-probe.startup', 'INFO', `perf-probe startup service=${svc}`)
  const heartbeat = setInterval(() => {
    writeInSpan('perf-probe.heartbeat', 'INFO', `perf-probe heartbeat service=${svc}`)
  }, SAMPLE_INTERVAL_MS)
  heartbeat.unref()

  return {
    write,
    async stop() {
      clearInterval(heartbeat)
      writeInSpan('perf-probe.shutdown', 'INFO', `perf-probe shutdown service=${svc}`)
      log.close()
    },
  }
}

function observeGcMetrics({ pauseHistogram, countCounter }) {
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      pauseHistogram.record(entry.duration)
      countCounter.add(1)
    }
  })
  observer.observe({ entryTypes: ['gc'] })

  return {
    stop() {
      observer.disconnect()
    },
  }
}

function createOtelRuntimeMetrics() {
  const meter = observabilityMetrics.getMeter('vt-perf-probe')
  const cpuCounter = meter.createCounter('process.cpu.time', {
    description: 'Process CPU time consumed between perf-probe samples.',
    unit: 's',
  })
  const gcPauseHistogram = meter.createHistogram('runtime.gc.pause', {
    description: 'Observed V8 garbage-collection pause duration.',
    unit: 'ms',
  })
  const gcCountCounter = meter.createCounter('runtime.gc.count', {
    description: 'Observed V8 garbage-collection event count.',
  })
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 })
  let previousCpu = process.cpuUsage()

  meter.createObservableGauge('process.memory.usage', {
    description: 'Process memory usage by memory type.',
    unit: 'By',
  }).addCallback((result) => {
    const memory = process.memoryUsage()
    result.observe(memory.rss, { type: 'rss' })
    result.observe(memory.heapUsed, { type: 'heap_used' })
    result.observe(memory.heapTotal, { type: 'heap_total' })
    result.observe(memory.external, { type: 'external' })
    result.observe(memory.arrayBuffers, { type: 'array_buffers' })
  })

  meter.createObservableGauge('nodejs.eventloop.delay', {
    description: 'Node.js event-loop delay percentile over the last collection window.',
    unit: 'ms',
  }).addCallback((result) => {
    result.observe(nsToMs(eventLoopDelay.percentile(50)), { quantile: '0.5' })
    result.observe(nsToMs(eventLoopDelay.percentile(99)), { quantile: '0.99' })
    eventLoopDelay.reset()
  })

  const recordCpuDelta = () => {
    const cpuDelta = process.cpuUsage(previousCpu)
    previousCpu = process.cpuUsage()
    cpuCounter.add(cpuDelta.user / 1_000_000, { type: 'user' })
    cpuCounter.add(cpuDelta.system / 1_000_000, { type: 'system' })
  }

  eventLoopDelay.enable()
  const gc = observeGcMetrics({
    pauseHistogram: gcPauseHistogram,
    countCounter: gcCountCounter,
  })
  const cpuInterval = setInterval(recordCpuDelta, SAMPLE_INTERVAL_MS)
  cpuInterval.unref()

  return {
    stop() {
      clearInterval(cpuInterval)
      recordCpuDelta()
      gc.stop()
      eventLoopDelay.disable()
    },
  }
}

function startPyroscopeWallProfiler({ pyroscope, svc, runUuid, samplingIntervalMicros }) {
  pyroscope.init({
    serverAddress: PYROSCOPE_URL,
    appName: svc,
    tags: {
      service_instance_id: runUuid,
    },
    flushIntervalMs: SAMPLE_INTERVAL_MS,
    wall: {
      collectCpuTime: true,
      samplingDurationMs: SAMPLE_INTERVAL_MS,
      samplingIntervalMicros,
    },
    heap: {
      samplingIntervalBytes: 64 * 1024 * 1024,
      stackDepth: 16,
    },
  })
  pyroscope.startWallProfiling()

  return {
    async stop() {
      await pyroscope.stopWallProfiling()
    },
  }
}

// Schedule stop-the-world heap snapshots at fixed offsets (deep tier only).
// The snapshot write and the timer are injected ports so the scheduler can be
// exercised against a real temp dir (assert files appear) without a profiler in
// the loop. The offset==0 snapshot is written synchronously; the rest deferred.
/**
 * @param {{
 *   heapSnapshotsDir: string,
 *   svc: string,
 *   offsetsMs?: readonly number[],
 *   writeSnapshot?: (path: string) => void,
 *   schedule?: (cb: () => void, ms: number) => unknown,
 *   onError?: (message: string) => void,
 * }} options
 */
export function scheduleHeapSnapshots({
  heapSnapshotsDir,
  svc,
  offsetsMs = HEAP_SNAPSHOT_OFFSETS_MS,
  writeSnapshot = writeHeapSnapshot,
  schedule = setTimeout,
  onError,
}) {
  const timers = []
  const snapshotPath = (offsetMs) =>
    join(heapSnapshotsDir, `${svc}.t${Math.round(offsetMs / 1000)}.heapsnapshot`)

  for (const offsetMs of offsetsMs) {
    if (offsetMs === 0) {
      writeSnapshot(snapshotPath(offsetMs))
      continue
    }
    const timer = schedule(() => {
      try {
        writeSnapshot(snapshotPath(offsetMs))
      } catch (err) {
        onError?.(`perf-probe heap-snapshot failed offsetMs=${offsetMs} error=${err instanceof Error ? err.message : String(err)}`)
      }
    }, offsetMs)
    if (timer && typeof timer === 'object' && typeof timer.unref === 'function') {
      timer.unref()
    }
    timers.push(timer)
  }

  return {
    stop() {
      for (const timer of timers) clearTimeout(timer)
    },
  }
}

function createStopOnce(stop) {
  let stopPromise
  const stopOnce = async () => {
    if (!stopPromise) {
      stopPromise = stop().catch((err) => {
        process.stderr.write(`perfProbeFromEnv: failed to stop profiler: ${err.message}\n`)
      })
    }
    await stopPromise
  }

  process.once('beforeExit', () => {
    void stopOnce()
  })

  return stopOnce
}

// Impure edge: execute a perf-probe plan. `off` is a complete no-op (returns
// undefined). `lite`/`deep` start wall sampling at the plan's rate, OTel runtime
// metrics, and the durable log/heartbeat; heap snapshots run iff plan.heapSnapshots.
// Returns an idempotent stop handle that flushes Pyroscope/metrics/log on call.
/**
 * @param {{ svc: string, plan: PerfProbePlan, env?: NodeJS.ProcessEnv }} options
 * @returns {Promise<undefined | (() => Promise<void>)>}
 */
export async function startPerfProbe({ svc, plan, env = process.env }) {
  if (plan.tier === 'off') return undefined

  const runUuid = resolveRunUuid(env)
  const runDir = resolveRunDir(runUuid)
  const paths = await ensureRunDirs(runDir)

  observabilityMetrics.init(svc, {
    otlpEndpoint: env[OTLP_ENDPOINT_ENV],
    instanceId: runUuid,
  })

  // Wall profiling is best-effort and runtime-dependent (see loadPyroscope). When
  // available it must be initialised before any code that calls wrapWithLabels —
  // createPlainLogWriter emits a startup span synchronously which routes through
  // wrapWithLabels for span_id labels. When unavailable (e.g. electron-main), the
  // probe still emits metrics, the durable log, and (deep) heap snapshots.
  const Pyroscope = await loadPyroscope()
  if (!Pyroscope) {
    process.stderr.write(
      `perf-probe: wall profiling unavailable in this runtime (@pyroscope/nodejs has no native build); ` +
        `metrics + log${plan.heapSnapshots ? ' + heap snapshots' : ''} still active for service=${svc}\n`,
    )
  }
  const pyroscope = Pyroscope
    ? startPyroscopeWallProfiler({
        pyroscope: Pyroscope,
        svc,
        runUuid,
        samplingIntervalMicros: plan.wallSamplingMicros,
      })
    : undefined
  const log = createPlainLogWriter({ pyroscope: Pyroscope, svc, logPath: join(paths.logsDir, `${svc}.log`) })
  const metrics = createOtelRuntimeMetrics()
  const heapSnapshots = plan.heapSnapshots
    ? scheduleHeapSnapshots({
        heapSnapshotsDir: paths.heapSnapshotsDir,
        svc,
        onError: (message) => log.write('ERROR', message),
      })
    : undefined

  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    heapSnapshots?.stop()
    metrics.stop()
    await pyroscope?.stop()
    await log.stop()
  }

  return createStopOnce(stop)
}

// Env-driven shell over startPerfProbe: resolve the plan, then execute it.
export function perfProbeFromEnv(svc, env = process.env) {
  return startPerfProbe({ svc, plan: perfProbePlan(env), env })
}

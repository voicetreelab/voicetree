import { mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks'
import { randomUUID } from 'node:crypto'
import { writeHeapSnapshot } from 'node:v8'

import Pyroscope from '@pyroscope/nodejs'
import { observabilityMetrics, tracing } from '@vt/observability'
import { createDurableLineLog } from './durable-line-log.mjs'

const PROFILE_ENABLED = '1'
const RUN_ID_ENV = 'VOICETREE_RUN_INSTANCE_ID'
const OTLP_ENDPOINT_ENV = 'VOICETREE_OTLP_ENDPOINT'
const PERF_PROFILE_ENV = 'VOICETREE_PERF_PROFILE'
const PYROSCOPE_URL = 'http://localhost:2995'
const SAMPLE_INTERVAL_MS = 1_000
const HEAP_SNAPSHOT_OFFSETS_MS = [0, 5_000, 10_000]

const nsToMs = (value) => value / 1_000_000

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

function createPlainLogWriter(svc, logPath) {
  const log = createDurableLineLog(logPath)

  const write = (level, message) => {
    log.writeLine(`${new Date().toISOString()} ${level} ${appendTraceContext(message, tracing.activeTraceContext())}`)
  }

  const writeInSpan = (spanName, level, message) => {
    tracing.syncSpan(spanName, () => {
      write(level, message)
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

function startPyroscopeWallProfiler({ svc, runUuid }) {
  Pyroscope.init({
    serverAddress: PYROSCOPE_URL,
    appName: svc,
    tags: {
      service_instance_id: runUuid,
    },
    flushIntervalMs: SAMPLE_INTERVAL_MS,
    wall: {
      collectCpuTime: true,
      samplingDurationMs: SAMPLE_INTERVAL_MS,
      samplingIntervalMicros: 1_000,
    },
    heap: {
      samplingIntervalBytes: 64 * 1024 * 1024,
      stackDepth: 16,
    },
  })
  Pyroscope.startWallProfiling()

  return {
    async stop() {
      await Pyroscope.stopWallProfiling()
    },
  }
}

function writeNamedHeapSnapshot({ heapSnapshotsDir, svc, label }) {
  writeHeapSnapshot(join(heapSnapshotsDir, `${svc}.${label}.heapsnapshot`))
}

function scheduleHeapSnapshots({ heapSnapshotsDir, svc, log }) {
  const timers = []

  for (const offsetMs of HEAP_SNAPSHOT_OFFSETS_MS) {
    const label = `t${Math.round(offsetMs / 1000)}`
    if (offsetMs === 0) {
      writeNamedHeapSnapshot({ heapSnapshotsDir, svc, label })
    } else {
      const timer = setTimeout(() => {
        try {
          writeNamedHeapSnapshot({ heapSnapshotsDir, svc, label })
        } catch (err) {
          log.write('ERROR', `perf-probe heap-snapshot failed label=${label} error=${err instanceof Error ? err.message : String(err)}`)
        }
      }, offsetMs)
      timer.unref()
      timers.push(timer)
    }
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

export async function perfProbeFromEnv(svc) {
  if (process.env[PERF_PROFILE_ENV] !== PROFILE_ENABLED) return undefined

  const runUuid = resolveRunUuid()
  const runDir = resolveRunDir(runUuid)
  const paths = await ensureRunDirs(runDir)
  const log = createPlainLogWriter(svc, join(paths.logsDir, `${svc}.log`))

  observabilityMetrics.init(svc, {
    otlpEndpoint: process.env[OTLP_ENDPOINT_ENV],
    instanceId: runUuid,
  })

  const metrics = createOtelRuntimeMetrics()
  const pyroscope = startPyroscopeWallProfiler({ svc, runUuid })
  const heapSnapshots = scheduleHeapSnapshots({
    heapSnapshotsDir: paths.heapSnapshotsDir,
    svc,
    log,
  })

  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    heapSnapshots.stop()
    metrics.stop()
    await pyroscope.stop()
    await log.stop()
  }

  return createStopOnce(stop)
}

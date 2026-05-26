import { createWriteStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Session } from 'node:inspector/promises'
import { monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks'
import { finished } from 'node:stream/promises'

const PROFILE_ENABLED = '1'
const RUN_DIR_ENV = 'VOICETREE_PERF_RUN_DIR'
const compactIsoTimestamp = (date = new Date()) => date.toISOString().replace(/\.\d{3}Z$/, '').replace(/:/g, '-')
const nsToMs = (value) => value / 1_000_000

function resolveRunDir() {
  if (process.env[RUN_DIR_ENV]) return process.env[RUN_DIR_ENV]

  const runDir = join(homedir(), '.voicetree', 'reports', `stable-perf-${compactIsoTimestamp()}`)
  process.env[RUN_DIR_ENV] = runDir
  return runDir
}

function observeGc() {
  let gcPauseMs = 0
  let gcCount = 0
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      gcPauseMs += entry.duration
      gcCount += 1
    }
  })
  observer.observe({ entryTypes: ['gc'] })

  return {
    readAndReset() {
      const result = { gc_pause_ms: gcPauseMs, gc_count: gcCount }
      gcPauseMs = 0
      gcCount = 0
      return result
    },
    stop() {
      observer.disconnect()
    },
  }
}

function createMetricSampler(svc, metricsPath) {
  const stream = createWriteStream(metricsPath, { flags: 'a' })
  const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 })
  const gc = observeGc()
  let previousCpu = process.cpuUsage()

  eventLoopDelay.enable()

  const writeRow = () => {
    const cpuDelta = process.cpuUsage(previousCpu)
    previousCpu = process.cpuUsage()
    const memory = process.memoryUsage()
    const row = {
      t: Date.now(),
      svc,
      cpu_user_ms: cpuDelta.user / 1000,
      cpu_sys_ms: cpuDelta.system / 1000,
      rss: memory.rss,
      heap_used: memory.heapUsed,
      heap_total: memory.heapTotal,
      external: memory.external,
      array_buffers: memory.arrayBuffers,
      eld_p50_ms: nsToMs(eventLoopDelay.percentile(50)),
      eld_p99_ms: nsToMs(eventLoopDelay.percentile(99)),
      ...gc.readAndReset(),
    }
    stream.write(`${JSON.stringify(row)}\n`)
    eventLoopDelay.reset()
  }

  const interval = setInterval(writeRow, 1000)
  interval.unref()

  return {
    async stop() {
      clearInterval(interval)
      writeRow()
      gc.stop()
      eventLoopDelay.disable()
      stream.end()
      await finished(stream)
    },
  }
}

async function writeJsonFile(path, value) {
  await writeFile(path, JSON.stringify(value), 'utf8')
}

const SIGNAL_EXIT_CODES = {
  SIGINT: 130,
  SIGTERM: 143,
}

function installShutdownHooks(stop) {
  let stopPromise
  const stopOnce = async () => {
    if (!stopPromise) {
      stopPromise = stop().catch((err) => {
        process.stderr.write(`perfProbeFromEnv: failed to stop profiler: ${(err).message}\n`)
      })
    }
    await stopPromise
  }

  const stopForSignal = (signal) => {
    void stopOnce().finally(() => {
      if (process.listenerCount(signal) === 0) {
        process.exit(SIGNAL_EXIT_CODES[signal])
      }
    })
  }

  process.once('SIGINT', () => stopForSignal('SIGINT'))
  process.once('SIGTERM', () => stopForSignal('SIGTERM'))
  process.once('beforeExit', () => {
    void stopOnce()
  })

  return stopOnce
}

export async function perfProbeFromEnv(svc) {
  if (process.env.VOICETREE_PERF_PROFILE !== PROFILE_ENABLED) return undefined

  const runDir = resolveRunDir()
  const metricsDir = join(runDir, 'metrics')
  const profilesDir = join(runDir, 'profiles')
  await mkdir(metricsDir, { recursive: true })
  await mkdir(profilesDir, { recursive: true })

  const session = new Session()
  session.connect()
  await session.post('Profiler.enable')
  await session.post('Profiler.start')

  const metrics = createMetricSampler(svc, join(metricsDir, `${svc}.metrics.ndjson`))
  let stopped = false
  const stop = async () => {
    if (stopped) return
    stopped = true
    const [{ profile }] = await Promise.all([
      session.post('Profiler.stop'),
      metrics.stop(),
    ])
    session.disconnect()
    await writeJsonFile(join(profilesDir, `${svc}.cpuprofile`), profile)
  }

  return installShutdownHooks(stop)
}

#!/usr/bin/env node
import { randomInt, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ATTR_SERVICE_INSTANCE_ID, ATTR_SERVICE_NAME } from '@opentelemetry/semantic-conventions'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const BACKEND_URL = 'http://localhost:2996'
const OTLP_GRPC_URL = 'http://127.0.0.1:2994'
const SERVICE_NAME = 'vt-test'
const METRIC_NAME = 'vt_test_counter'
const POLL_INTERVAL_MS = 500
const POLL_TIMEOUT_MS = 10_000

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function makeRunContext() {
  return {
    runUuid: process.env.VOICETREE_RUN_INSTANCE_ID ?? randomUUID(),
  }
}

function makePaths(runUuid) {
  const runDir = join(homedir(), '.voicetree', 'perf', runUuid)
  return {
    metricMirrorPath: join(runDir, 'metrics', `${SERVICE_NAME}.metrics.ndjson`),
    verifyPath: join(runDir, 'verify', 'metrics.json'),
  }
}

function makeQuery(sentinel) {
  return `${METRIC_NAME}{sentinel="${sentinel}"}`
}

function queryUrl(query) {
  const url = new URL('/api/v1/query', BACKEND_URL)
  url.searchParams.set('query', query)
  return url
}

function victoriaMetricsHasResult(payload) {
  return payload?.status === 'success'
    && Array.isArray(payload?.data?.result)
    && payload.data.result.length > 0
}

async function pushCounterMetric({ runUuid, sentinel }) {
  const exporter = new OTLPMetricExporter({ url: OTLP_GRPC_URL })
  const reader = new PeriodicExportingMetricReader({
    exporter,
    exportIntervalMillis: 1000,
  })
  const provider = new MeterProvider({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_INSTANCE_ID]: runUuid,
    }),
    readers: [reader],
  })

  try {
    const meter = provider.getMeter('vt-perf-stack-verify-metrics')
    const counter = meter.createCounter(METRIC_NAME, {
      description: 'Synthetic counter used by perf-stack metrics verification.',
    })
    counter.add(1, { sentinel: String(sentinel) })
    await provider.forceFlush()
  } finally {
    await provider.shutdown()
  }
}

async function pollVictoriaMetrics(query) {
  const startedAt = Date.now()
  let lastPayload
  let lastError

  while (Date.now() - startedAt <= POLL_TIMEOUT_MS) {
    try {
      const response = await fetch(queryUrl(query), {
        signal: AbortSignal.timeout(1000),
      })
      lastPayload = await response.json()
      if (response.ok && victoriaMetricsHasResult(lastPayload)) {
        return { ok: true, lastPayload }
      }
    } catch (err) {
      lastError = err
    }
    await delay(POLL_INTERVAL_MS)
  }

  return {
    ok: false,
    lastPayload,
    lastError: lastError instanceof Error ? lastError.message : undefined,
  }
}

async function pollMetricMirror({ metricMirrorPath, sentinel }) {
  const startedAt = Date.now()
  let lastError

  while (Date.now() - startedAt <= POLL_TIMEOUT_MS) {
    try {
      const text = await readFile(metricMirrorPath, 'utf8')
      if (text.includes(`"sentinel":"${sentinel}"`) || text.includes(String(sentinel))) {
        return { ok: true }
      }
    } catch (err) {
      lastError = err
    }
    await delay(POLL_INTERVAL_MS)
  }

  return {
    ok: false,
    lastError: lastError instanceof Error ? lastError.message : undefined,
  }
}

async function writeResult({ verifyPath, result }) {
  await mkdir(dirname(verifyPath), { recursive: true })
  await writeFile(verifyPath, `${JSON.stringify(result, null, 2)}\n`)
}

async function verifyMetrics() {
  const sentinel = randomInt(0, 2 ** 32)
  const startedAt = Date.now()
  const runContext = makeRunContext()
  const paths = makePaths(runContext.runUuid)
  const query = makeQuery(sentinel)

  let backend = { ok: false }
  let mirror = { ok: false }
  let pushError

  try {
    await pushCounterMetric({ runUuid: runContext.runUuid, sentinel })
    const checks = await Promise.all([
      pollVictoriaMetrics(query),
      pollMetricMirror({ metricMirrorPath: paths.metricMirrorPath, sentinel }),
    ])
    backend = checks[0]
    mirror = checks[1]
  } catch (err) {
    pushError = err instanceof Error ? err.message : String(err)
  }

  const ok = backend.ok && mirror.ok
  const result = {
    signal: 'metrics',
    ok,
    sentinel,
    round_trip_ms: Date.now() - startedAt,
    backend_url: BACKEND_URL,
    query,
    details: {
      backend_returned_value: backend.ok,
      file_mirror_present: mirror.ok,
      metric_mirror_path: paths.metricMirrorPath,
      service_instance_id: runContext.runUuid,
      backend_last_error: backend.lastError,
      file_mirror_last_error: mirror.lastError,
      push_error: pushError,
    },
  }

  await writeResult({ verifyPath: paths.verifyPath, result })
  console.log(`${ok ? 'ok' : 'fail'} metrics round-trip ${result.round_trip_ms}ms result=${paths.verifyPath}`)
  return ok
}

const ok = await verifyMetrics()
process.exit(ok ? 0 : 1)

#!/usr/bin/env node
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import { trace } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc'
import { resourceFromAttributes } from '@opentelemetry/resources'
import { SimpleSpanProcessor } from '@opentelemetry/sdk-trace-base'
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node'
import {
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_SERVICE_NAME,
} from '@opentelemetry/semantic-conventions'

const BACKEND_URL = 'http://localhost:3200'
const OTLP_GRPC_URL = 'http://127.0.0.1:4317'
const SERVICE_NAME = 'vt-test'
const SIGNAL = 'traces'
const POLL_INTERVAL_MS = 500
const POLL_TIMEOUT_MS = 10_000

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function makeTraceId() {
  return randomBytes(16).toString('hex')
}

function makeSpanId() {
  return randomBytes(8).toString('hex')
}

function makeRunContext() {
  return {
    runUuid: process.env.VOICETREE_RUN_INSTANCE_ID ?? randomUUID(),
    collectorRunIdWasExplicit: Boolean(process.env.VOICETREE_RUN_INSTANCE_ID),
  }
}

function makePaths(runUuid) {
  const runDir = join(homedir(), '.voicetree', 'perf', runUuid)
  return {
    runDir,
    traceMirrorPath: join(runDir, 'traces', `${SERVICE_NAME}.spans.ndjson`),
    verifyPath: join(runDir, 'verify', `${SIGNAL}.json`),
  }
}

function makeFixedTraceIdGenerator(traceId) {
  let usedFixedTraceId = false
  return {
    generateTraceId() {
      if (usedFixedTraceId) return makeTraceId()
      usedFixedTraceId = true
      return traceId
    },
    generateSpanId: makeSpanId,
  }
}

async function pushTrace({ runUuid, traceId }) {
  const exporter = new OTLPTraceExporter({ url: OTLP_GRPC_URL })
  const provider = new NodeTracerProvider({
    idGenerator: makeFixedTraceIdGenerator(traceId),
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: SERVICE_NAME,
      [ATTR_SERVICE_INSTANCE_ID]: runUuid,
    }),
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  })
  provider.register()

  try {
    const tracer = trace.getTracer('vt-perf-stack-verify-traces')
    const span = tracer.startSpan('vt.verify.traces.sentinel', {
      attributes: {
        'vt.verify.signal': SIGNAL,
        'vt.verify.sentinel_trace_id': traceId,
      },
    })
    span.end()
    await provider.forceFlush()
  } finally {
    await provider.shutdown()
  }
}

async function queryTempo(traceId) {
  const response = await fetch(`${BACKEND_URL}/api/traces/${traceId}`, {
    signal: AbortSignal.timeout(1_000),
  })
  const body = await response.text()
  return {
    ok: response.ok && body.includes(traceId),
    status: response.status,
    body,
  }
}

async function pollTempo(traceId) {
  const startedAt = Date.now()
  let lastStatus
  let lastError

  while (Date.now() - startedAt <= POLL_TIMEOUT_MS) {
    try {
      const payload = await queryTempo(traceId)
      lastStatus = payload.status
      if (payload.ok) return { ok: true, lastStatus }
    } catch (err) {
      lastError = err
    }
    await delay(POLL_INTERVAL_MS)
  }

  return {
    ok: false,
    lastStatus,
    lastError: lastError instanceof Error ? lastError.message : undefined,
  }
}

async function pollTraceMirror({ traceMirrorPath, traceId }) {
  const startedAt = Date.now()
  let lastError

  while (Date.now() - startedAt <= POLL_TIMEOUT_MS) {
    try {
      const text = await readFile(traceMirrorPath, 'utf8')
      if (text.includes(traceId)) return { ok: true }
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

async function verifyTraces() {
  const traceId = makeTraceId()
  const startedAt = Date.now()
  const runContext = makeRunContext()
  const paths = makePaths(runContext.runUuid)
  const query = `GET /api/traces/${traceId}`

  let backend = { ok: false }
  let mirror = { ok: false }
  let pushError

  try {
    await pushTrace({ runUuid: runContext.runUuid, traceId })
    const checks = await Promise.all([
      pollTempo(traceId),
      pollTraceMirror({ traceMirrorPath: paths.traceMirrorPath, traceId }),
    ])
    backend = checks[0]
    mirror = checks[1]
  } catch (err) {
    pushError = err instanceof Error ? err.message : String(err)
  }

  const ok = backend.ok && mirror.ok
  const result = {
    signal: SIGNAL,
    ok,
    sentinel: traceId,
    round_trip_ms: Date.now() - startedAt,
    backend_url: BACKEND_URL,
    query,
    details: {
      backend_returned_trace: backend.ok,
      file_mirror_present: mirror.ok,
      trace_mirror_path: paths.traceMirrorPath,
      service_instance_id: runContext.runUuid,
      collector_run_id_env_present: runContext.collectorRunIdWasExplicit,
      backend_last_status: backend.lastStatus,
      backend_last_error: backend.lastError,
      file_mirror_last_error: mirror.lastError,
      push_error: pushError,
    },
  }

  await writeResult({ verifyPath: paths.verifyPath, result })
  console.log(`${ok ? 'ok' : 'fail'} traces round-trip ${result.round_trip_ms}ms result=${paths.verifyPath}`)
  if (!runContext.collectorRunIdWasExplicit) {
    console.log('note: traces file exporter is scoped by VOICETREE_RUN_INSTANCE_ID at collector startup; start the stack and this verifier with the same value for file-mirror verification.')
  }
  return ok
}

const ok = await verifyTraces()
process.exit(ok ? 0 : 1)

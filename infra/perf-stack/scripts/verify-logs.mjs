#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const BACKEND_URL = 'http://localhost:3100'
const SIGNAL = 'logs'
const POLL_INTERVAL_MS = 500
const TIMEOUT_MS = 10_000

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const requireHome = () => {
  if (!process.env.HOME) throw new Error('HOME is required to write perf verification artifacts')
  return process.env.HOME
}

const countLokiEvents = (payload) => {
  const streams = payload?.data?.result
  if (!Array.isArray(streams)) return 0
  return streams.reduce((count, stream) => count + (Array.isArray(stream.values) ? stream.values.length : 0), 0)
}

const queryLoki = async ({ query, injectedAtMs }) => {
  const params = new URLSearchParams({
    query,
    limit: '1',
    start: String(BigInt(injectedAtMs - 5_000) * 1_000_000n),
    end: String(BigInt(Date.now() + 1_000) * 1_000_000n),
  })
  const response = await fetch(`${BACKEND_URL}/loki/api/v1/query_range?${params}`, {
    signal: AbortSignal.timeout(1_000),
  })
  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Loki query failed: ${response.status} ${body.trim()}`)
  }
  return response.json()
}

const writeResult = async ({ runDir, result }) => {
  const verifyDir = join(runDir, 'verify')
  await mkdir(verifyDir, { recursive: true })
  const resultPath = join(verifyDir, `${SIGNAL}.json`)
  await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`)
  return resultPath
}

const verifyLogs = async () => {
  const home = requireHome()
  const sentinel = randomUUID()
  const runUuid = process.env.VOICETREE_RUN_INSTANCE_ID ?? randomUUID()
  const runDir = join(home, '.voicetree', 'perf', runUuid)
  const logPath = join(runDir, 'logs', 'vt-test.log')
  const injectedAtMs = Date.now()
  const query = `{service_name="vt-test"} |= "${sentinel}"`

  await mkdir(dirname(logPath), { recursive: true })
  await writeFile(logPath, `${new Date(injectedAtMs).toISOString()} INFO sentinel=${sentinel}\n`, {
    flag: 'a',
  })

  let eventsReturned = 0
  let lastError
  while (Date.now() - injectedAtMs <= TIMEOUT_MS) {
    await delay(POLL_INTERVAL_MS)
    try {
      const payload = await queryLoki({ query, injectedAtMs })
      eventsReturned = countLokiEvents(payload)
      if (eventsReturned > 0) break
    } catch (err) {
      lastError = err
    }
  }

  const ok = eventsReturned > 0
  const result = {
    signal: SIGNAL,
    ok,
    sentinel,
    injected_at_ms: injectedAtMs,
    round_trip_ms: Date.now() - injectedAtMs,
    backend_url: BACKEND_URL,
    query,
    details: {
      events_returned: eventsReturned,
      ...(lastError && !ok ? { last_error: lastError.message } : {}),
    },
  }
  const resultPath = await writeResult({ runDir, result })
  console.log(ok
    ? `logs OK round_trip_ms=${result.round_trip_ms} result=${resultPath}`
    : `logs FAIL timeout_ms=${TIMEOUT_MS} result=${resultPath}`)
  return ok
}

verifyLogs()
  .then((ok) => process.exit(ok ? 0 : 1))
  .catch((err) => {
    console.error(err.message)
    process.exit(1)
  })

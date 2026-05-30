#!/usr/bin/env node
// BF-412 acceptance check: after an interactive `npm run electron(:prod)` run,
// assert that BOTH the electron main process AND the spawned graph daemon got
// their spans onto the wire — i.e. Tempo can return traces for
// service.name=vt-electron-main AND service.name=vt-graphd, filtered to this
// run's service.instance.id (VOICETREE_RUN_INSTANCE_ID printed at launch).
//
// Usage:
//   node infra/perf-stack/scripts/verify-electron-run.mjs <run-instance-id>
//   VOICETREE_RUN_INSTANCE_ID=<id> node infra/perf-stack/scripts/verify-electron-run.mjs
//
// Reuses Tempo's /api/search TraceQL contract (same backend the storm verifier
// hits). `checkServicesPresent` is the deep, pure-ish core (injected `search`);
// the CLI shell adds real HTTP + polling.
import { pathToFileURL } from 'node:url'

const DEFAULT_TEMPO_ADDR = 'http://localhost:2997'
const REQUIRED_SERVICES = ['vt-electron-main', 'vt-graphd']
const POLL_INTERVAL_MS = 1_000
// Tempo's index lags ingestion by a flush cycle; give it generous headroom so a
// just-finished run is found rather than spuriously failing.
const POLL_TIMEOUT_MS = 30_000

/** TraceQL selecting one service's spans within a single run. */
export function traceqlForRun(service, runId) {
  return `{ resource.service.name="${service}" && resource.service.instance.id="${runId}" }`
}

/** Count traces in a Tempo /api/search response, tolerating an empty/odd shape. */
export function tempoSearchTraceCount(payload) {
  return Array.isArray(payload?.traces) ? payload.traces.length : 0
}

/**
 * One-shot presence check across `services` for `runId`. `search(traceql)`
 * returns a parsed Tempo /api/search payload. Returns one row per service so a
 * caller (or a test) can assert on the observable verdict.
 *
 * @param {{ services: string[], runId: string, search: (traceql: string) => Promise<unknown> }} input
 */
export async function checkServicesPresent({ services, runId, search }) {
  return Promise.all(
    services.map(async (service) => {
      const query = traceqlForRun(service, runId)
      const traceCount = tempoSearchTraceCount(await search(query))
      return { service, query, traceCount, ok: traceCount > 0 }
    }),
  )
}

// ---------------------------------------------------------------------------
// CLI shell
// ---------------------------------------------------------------------------

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function makeTempoSearch(tempoAddr) {
  return async (traceql) => {
    const url = new URL('/api/search', tempoAddr)
    url.searchParams.set('q', traceql)
    url.searchParams.set('limit', '20')
    url.searchParams.set('start', String(Math.floor((Date.now() - POLL_TIMEOUT_MS - 3_600_000) / 1_000)))
    url.searchParams.set('end', String(Math.floor(Date.now() / 1_000)))
    const response = await fetch(url, { signal: AbortSignal.timeout(2_000) })
    if (!response.ok) return { traces: [] }
    return response.json().catch(() => ({ traces: [] }))
  }
}

async function pollUntilPresent({ services, runId, search }) {
  const startedAt = Date.now()
  let rows = []
  while (Date.now() - startedAt <= POLL_TIMEOUT_MS) {
    rows = await checkServicesPresent({ services, runId, search }).catch(() =>
      services.map((service) => ({ service, query: traceqlForRun(service, runId), traceCount: 0, ok: false })),
    )
    if (rows.every((row) => row.ok)) return rows
    await delay(POLL_INTERVAL_MS)
  }
  return rows
}

async function main(argv = process.argv.slice(2), env = process.env) {
  const runId = argv[0] ?? env.VOICETREE_RUN_INSTANCE_ID
  if (!runId) {
    throw new Error(
      'missing run instance id: pass it as the first argument or set VOICETREE_RUN_INSTANCE_ID',
    )
  }
  const tempoAddr = env.TEMPO_ADDR || DEFAULT_TEMPO_ADDR
  const rows = await pollUntilPresent({
    services: REQUIRED_SERVICES,
    runId,
    search: makeTempoSearch(tempoAddr),
  })

  console.log(`verify-electron-run: run=${runId} tempo=${tempoAddr}`)
  for (const row of rows) {
    console.log(`  ${row.ok ? 'ok  ' : 'MISS'} ${row.service.padEnd(16)} traces=${row.traceCount}`)
  }
  const ok = rows.every((row) => row.ok)
  console.log(ok ? 'ok: both services present for this run' : 'fail: missing service traces for this run')
  return ok
}

const isEntrypoint = import.meta.url === pathToFileURL(process.argv[1]).href
if (isEntrypoint) {
  main().then(
    (ok) => {
      process.exitCode = ok ? 0 : 1
    },
    (err) => {
      console.error(`verify-electron-run: ${err instanceof Error ? err.message : String(err)}`)
      process.exitCode = 1
    },
  )
}

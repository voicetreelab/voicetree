import test from 'node:test'
import assert from 'node:assert/strict'

import {
  checkServicesPresent,
  tempoSearchTraceCount,
  traceqlForRun,
} from './verify-electron-run.mjs'

test('traceqlForRun filters by both service.name and the run instance id', () => {
  assert.equal(
    traceqlForRun('vt-graphd', 'run-123'),
    '{ resource.service.name="vt-graphd" && resource.service.instance.id="run-123" }',
  )
})

test('tempoSearchTraceCount reads the traces array and tolerates empty shapes', () => {
  assert.equal(tempoSearchTraceCount({ traces: [{}, {}] }), 2)
  assert.equal(tempoSearchTraceCount({ traces: [] }), 0)
  assert.equal(tempoSearchTraceCount({}), 0)
  assert.equal(tempoSearchTraceCount(undefined), 0)
})

// A fake Tempo: maps a TraceQL query to a canned /api/search payload.
function fakeTempo(byQuery) {
  return (traceql) => Promise.resolve(byQuery[traceql] ?? { traces: [] })
}

test('passes only when BOTH required services return traces for the run', async () => {
  const runId = 'run-ok'
  const search = fakeTempo({
    [traceqlForRun('vt-electron-main', runId)]: { traces: [{ traceID: 'a' }] },
    [traceqlForRun('vt-graphd', runId)]: { traces: [{ traceID: 'b' }] },
  })

  const rows = await checkServicesPresent({
    services: ['vt-electron-main', 'vt-graphd'],
    runId,
    search,
  })

  assert.deepEqual(
    rows.map((r) => ({ service: r.service, ok: r.ok })),
    [
      { service: 'vt-electron-main', ok: true },
      { service: 'vt-graphd', ok: true },
    ],
  )
  assert.ok(rows.every((r) => r.ok))
})

test('fails when the daemon span never reached the collector (graphd missing)', async () => {
  const runId = 'run-no-graphd'
  const search = fakeTempo({
    [traceqlForRun('vt-electron-main', runId)]: { traces: [{ traceID: 'a' }] },
    // vt-graphd absent → default { traces: [] }
  })

  const rows = await checkServicesPresent({
    services: ['vt-electron-main', 'vt-graphd'],
    runId,
    search,
  })

  const graphd = rows.find((r) => r.service === 'vt-graphd')
  assert.equal(graphd.ok, false, 'graphd flagged missing')
  assert.equal(rows.every((r) => r.ok), false, 'overall verdict is fail')
})

test('a different run id does not satisfy the check (instance-id scoping)', async () => {
  const search = fakeTempo({
    [traceqlForRun('vt-electron-main', 'run-A')]: { traces: [{ traceID: 'a' }] },
    [traceqlForRun('vt-graphd', 'run-A')]: { traces: [{ traceID: 'b' }] },
  })

  const rows = await checkServicesPresent({
    services: ['vt-electron-main', 'vt-graphd'],
    runId: 'run-B',
    search,
  })

  assert.equal(rows.every((r) => r.ok), false, 'run-B has no traces despite run-A being present')
})

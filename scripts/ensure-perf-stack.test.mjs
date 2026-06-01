import test from 'node:test'
import assert from 'node:assert/strict'

import { ensurePerfStack } from './ensure-perf-stack.mjs'

// The set of binaries a complete install produces, abbreviated for the tests.
// The harness models bin/ as the SET of present binary files (not a single
// installed/not-installed flag) so a *partial* install — some present, some
// missing — is representable and assertable.
const ALL = ['grafana', 'loki', 'tempo']

// Black-box harness: a tiny in-memory interpreter of the perf-stack effect
// vocabulary. `run('install' | 'up')` mutates world-state (which binaries are
// present / whether the stack is running) exactly as the real subprocesses
// would, so tests assert on the *observable result of the side effects* rather
// than on whether an internal helper was called. `installIsComplete` mirrors
// the real bin/ probe by reading the same world-state.
function fakePerfStack({
  present = [],
  running = false,
  expected = ALL,
  installCode = 0,
  upCode = 0,
  failInstallIfComplete = false,
} = {}) {
  const world = { present: new Set(present), running }
  const isComplete = () => expected.every((name) => world.present.has(name))
  return {
    world,
    installIsComplete: () => Promise.resolve(isComplete()),
    run: (action) => {
      if (action === 'install') {
        // A correct preflight never reinstalls when the install is already
        // complete; encode that contract as the boundary refusing the call.
        if (failInstallIfComplete && isComplete()) {
          throw new Error('install must not run when the install is already complete')
        }
        // The real installer is idempotent and converges on the full set: it
        // fills in every missing binary and no-ops the ones already present.
        if (installCode === 0) for (const name of expected) world.present.add(name)
        return Promise.resolve({ code: installCode, stderr: installCode ? 'download failed' : '' })
      }
      if (action === 'up') {
        // `up` dies on the first missing binary — the real failure mode this
        // models ("tempo binary missing"). It succeeds only on a full install.
        if (!isComplete()) return Promise.resolve({ code: 1, stderr: 'tempo binary missing' })
        if (upCode === 0) world.running = true
        return Promise.resolve({ code: upCode, stderr: upCode ? 'port 2994 busy' : '' })
      }
      throw new Error(`unexpected action: ${action}`)
    },
  }
}

const silent = () => {}

test('cold start: installs binaries then brings the stack up', async () => {
  const stack = fakePerfStack({ present: [], running: false })

  const result = await ensurePerfStack({
    env: {},
    run: stack.run,
    installIsComplete: stack.installIsComplete,
    log: silent,
    newRunId: () => 'run-cold',
  })

  assert.equal(stack.world.present.size, ALL.length, 'all binaries got installed')
  assert.equal(stack.world.running, true, 'stack got brought up')
  assert.deepEqual(result, {
    enabled: true,
    endpoint: 'http://localhost:2994',
    instanceId: 'run-cold',
    tier: 'lite',
  })
})

test('partial install converges: missing binaries trigger a reinstall, then up', async () => {
  // bin/ holds only 1 of 3 expected binaries — an install interrupted partway
  // (Ctrl-C, sleep, a failed source-build). The old probe ("any file present?")
  // treated this as complete and proceeded straight to a doomed `up`; the
  // completeness probe re-runs the idempotent installer and converges instead.
  const stack = fakePerfStack({ present: ['grafana'], running: false })

  const result = await ensurePerfStack({
    env: {},
    run: stack.run,
    installIsComplete: stack.installIsComplete,
    log: silent,
    newRunId: () => 'run-partial',
  })

  assert.equal(stack.world.present.size, ALL.length, 'reinstall filled in the missing binaries')
  assert.equal(stack.world.running, true, 'stack came up after recovery')
  assert.equal(result.enabled, true)
})

test('an enabled preflight selects the always-on lite perf tier', async () => {
  const stack = fakePerfStack({ present: ALL, running: true })

  const result = await ensurePerfStack({
    env: {},
    run: stack.run,
    installIsComplete: stack.installIsComplete,
    log: silent,
    newRunId: () => 'run-tier',
  })

  assert.equal(result.tier, 'lite', 'interactive launches profile at the lite tier')
})

test('an incomplete install emits the one-time progress line', async () => {
  const stack = fakePerfStack({ present: [] })
  const lines = []

  await ensurePerfStack({
    env: {},
    run: stack.run,
    installIsComplete: stack.installIsComplete,
    log: (message) => lines.push(message),
    newRunId: () => 'run-x',
  })

  assert.deepEqual(lines, ['installing perf stack…'])
})

test('warm stack: complete install → no reinstall, just an idempotent up', async () => {
  // failInstallIfComplete makes the boundary throw if install is wrongly invoked.
  const stack = fakePerfStack({ present: ALL, running: true, failInstallIfComplete: true })
  const lines = []

  const result = await ensurePerfStack({
    env: {},
    run: stack.run,
    installIsComplete: stack.installIsComplete,
    log: (message) => lines.push(message),
    newRunId: () => 'run-warm',
  })

  assert.equal(stack.world.present.size, ALL.length)
  assert.equal(stack.world.running, true)
  assert.deepEqual(lines, [], 'no install message on a complete, warm stack')
  assert.equal(result.endpoint, 'http://localhost:2994')
  assert.equal(result.instanceId, 'run-warm')
})

test('up failure surfaces a clear error and does not silently succeed', async () => {
  const stack = fakePerfStack({ present: ALL, running: false, upCode: 1 })

  await assert.rejects(
    ensurePerfStack({
      env: {},
      run: stack.run,
      installIsComplete: stack.installIsComplete,
      log: silent,
    }),
    /failed to start the perf stack \(exit 1\)[\s\S]*port 2994 busy/,
  )
  assert.equal(stack.world.running, false)
})

test('install failure aborts before attempting up', async () => {
  const stack = fakePerfStack({ present: [], installCode: 1 })

  await assert.rejects(
    ensurePerfStack({
      env: {},
      run: stack.run,
      installIsComplete: stack.installIsComplete,
      log: silent,
    }),
    /failed to install perf stack binaries \(exit 1\)[\s\S]*download failed/,
  )
  assert.equal(stack.world.running, false, 'up was never attempted')
})

test('PERF_STACK=0 is a complete no-op: no install, no up, exporter left detached', async () => {
  const stack = fakePerfStack({ present: [], running: false })
  let installs = 0
  let ups = 0
  const countingRun = (action) => {
    if (action === 'install') installs += 1
    if (action === 'up') ups += 1
    return stack.run(action)
  }

  const result = await ensurePerfStack({
    env: { PERF_STACK: '0' },
    run: countingRun,
    installIsComplete: stack.installIsComplete,
    log: silent,
  })

  assert.deepEqual(result, { enabled: false })
  assert.equal(installs, 0, 'no install subprocess ran')
  assert.equal(ups, 0, 'no up subprocess ran')
  assert.equal(stack.world.present.size, 0)
  assert.equal(stack.world.running, false)
})

test('honors a caller-provided endpoint and run instance id from env', async () => {
  const stack = fakePerfStack({ present: ALL, running: true })

  const result = await ensurePerfStack({
    env: {
      VOICETREE_OTLP_ENDPOINT: 'http://localhost:9999',
      VOICETREE_RUN_INSTANCE_ID: 'preset-run',
    },
    run: stack.run,
    installIsComplete: stack.installIsComplete,
    log: silent,
    newRunId: () => 'should-not-be-used',
  })

  assert.equal(result.endpoint, 'http://localhost:9999')
  assert.equal(result.instanceId, 'preset-run')
})

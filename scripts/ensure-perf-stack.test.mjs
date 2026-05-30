import test from 'node:test'
import assert from 'node:assert/strict'

import { ensurePerfStack } from './ensure-perf-stack.mjs'

// Black-box harness: a tiny in-memory interpreter of the perf-stack effect
// vocabulary. `run('install' | 'up')` mutates world-state (installed/running)
// exactly as the real subprocesses would, so tests assert on the *observable
// result of the side effects* (did the stack become installed/running?) rather
// than on whether an internal helper was called. `binHasContents` mirrors the
// real bin/ probe by reading the same world-state.
function fakePerfStack({
  installed = false,
  running = false,
  installCode = 0,
  upCode = 0,
  failInstallIfPresent = false,
} = {}) {
  const world = { installed, running }
  return {
    world,
    binHasContents: () => Promise.resolve(world.installed),
    run: (action) => {
      if (action === 'install') {
        // A correct preflight never reinstalls when binaries are already
        // present; encode that contract as the boundary refusing the call.
        if (failInstallIfPresent && world.installed) {
          throw new Error('install must not run when binaries are already present')
        }
        if (installCode === 0) world.installed = true
        return Promise.resolve({ code: installCode, stderr: installCode ? 'download failed' : '' })
      }
      if (action === 'up') {
        if (upCode === 0) world.running = true
        return Promise.resolve({ code: upCode, stderr: upCode ? 'port 2994 busy' : '' })
      }
      throw new Error(`unexpected action: ${action}`)
    },
  }
}

const silent = () => {}

test('cold start: installs binaries then brings the stack up', async () => {
  const stack = fakePerfStack({ installed: false, running: false })

  const result = await ensurePerfStack({
    env: {},
    run: stack.run,
    binHasContents: stack.binHasContents,
    log: silent,
    newRunId: () => 'run-cold',
  })

  assert.equal(stack.world.installed, true, 'binaries got installed')
  assert.equal(stack.world.running, true, 'stack got brought up')
  assert.deepEqual(result, {
    enabled: true,
    endpoint: 'http://localhost:2994',
    instanceId: 'run-cold',
  })
})

test('first-run install emits the one-time progress line', async () => {
  const stack = fakePerfStack({ installed: false })
  const lines = []

  await ensurePerfStack({
    env: {},
    run: stack.run,
    binHasContents: stack.binHasContents,
    log: (message) => lines.push(message),
    newRunId: () => 'run-x',
  })

  assert.deepEqual(lines, ['installing perf stack (first run only)…'])
})

test('warm stack: already installed → no reinstall, just an idempotent up', async () => {
  // failInstallIfPresent makes the boundary throw if install is wrongly invoked.
  const stack = fakePerfStack({ installed: true, running: true, failInstallIfPresent: true })
  const lines = []

  const result = await ensurePerfStack({
    env: {},
    run: stack.run,
    binHasContents: stack.binHasContents,
    log: (message) => lines.push(message),
    newRunId: () => 'run-warm',
  })

  assert.equal(stack.world.installed, true)
  assert.equal(stack.world.running, true)
  assert.deepEqual(lines, [], 'no first-run install message on a warm stack')
  assert.equal(result.endpoint, 'http://localhost:2994')
  assert.equal(result.instanceId, 'run-warm')
})

test('up failure surfaces a clear error and does not silently succeed', async () => {
  const stack = fakePerfStack({ installed: true, running: false, upCode: 1 })

  await assert.rejects(
    ensurePerfStack({
      env: {},
      run: stack.run,
      binHasContents: stack.binHasContents,
      log: silent,
    }),
    /failed to start the perf stack \(exit 1\)[\s\S]*port 2994 busy/,
  )
  assert.equal(stack.world.running, false)
})

test('install failure aborts before attempting up', async () => {
  const stack = fakePerfStack({ installed: false, installCode: 1 })

  await assert.rejects(
    ensurePerfStack({
      env: {},
      run: stack.run,
      binHasContents: stack.binHasContents,
      log: silent,
    }),
    /failed to install perf stack binaries \(exit 1\)[\s\S]*download failed/,
  )
  assert.equal(stack.world.running, false, 'up was never attempted')
})

test('honors a caller-provided endpoint and run instance id from env', async () => {
  const stack = fakePerfStack({ installed: true, running: true })

  const result = await ensurePerfStack({
    env: {
      VOICETREE_OTLP_ENDPOINT: 'http://localhost:9999',
      VOICETREE_RUN_INSTANCE_ID: 'preset-run',
    },
    run: stack.run,
    binHasContents: stack.binHasContents,
    log: silent,
    newRunId: () => 'should-not-be-used',
  })

  assert.equal(result.endpoint, 'http://localhost:9999')
  assert.equal(result.instanceId, 'preset-run')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

import { profileEnv } from './run-electron-profile.mjs'

const execFileAsync = promisify(execFile)

test('storm profile env selects the deep tier and no longer sets the retired flag', () => {
  const env = profileEnv({ baseEnv: {}, runUuid: 'run-storm', otlpEnabled: true })

  assert.equal(env.VOICETREE_PERF_TIER, 'deep')
  assert.equal(env.VOICETREE_PERF_PROFILE, undefined, 'the boolean flag is retired')
  assert.equal(env.VOICETREE_RUN_INSTANCE_ID, 'run-storm')
  assert.equal(env.VOICETREE_OTLP_ENDPOINT, 'http://localhost:2994')
})

test('--no-otlp keeps the deep tier but detaches the collector endpoint', () => {
  const env = profileEnv({
    baseEnv: { VOICETREE_OTLP_ENDPOINT: 'http://localhost:9999' },
    runUuid: 'run-local',
    otlpEnabled: false,
  })

  assert.equal(env.VOICETREE_PERF_TIER, 'deep')
  assert.equal(env.VOICETREE_OTLP_ENDPOINT, undefined, 'export endpoint stripped under --no-otlp')
})

test('electron profile wrapper documents the stamped OTLP default and standalone mode', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/run-electron-profile.mjs',
    '--help',
  ])

  assert.match(stdout, /Usage: pnpm --filter voicetree-webapp run electron:profile/)
  assert.match(stdout, /VOICETREE_RUN_INSTANCE_ID/)
  assert.match(stdout, /VOICETREE_OTLP_ENDPOINT=http:\/\/localhost:2994/)
  assert.match(stdout, /--no-otlp/)
})

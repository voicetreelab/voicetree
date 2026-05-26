import test from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

test('electron profile wrapper documents the stamped OTLP default and standalone mode', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/run-electron-profile.mjs',
    '--help',
  ])

  assert.match(stdout, /Usage: npm run electron:profile/)
  assert.match(stdout, /VOICETREE_RUN_INSTANCE_ID/)
  assert.match(stdout, /VOICETREE_OTLP_ENDPOINT=http:\/\/localhost:4317/)
  assert.match(stdout, /--no-otlp/)
})

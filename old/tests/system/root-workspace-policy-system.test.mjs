import assert from 'node:assert/strict'
import {spawnSync} from 'node:child_process'
import test from 'node:test'

const repoRoot = new URL('../..', import.meta.url)

function runNpmScript(scriptName) {
  const result = spawnSync('npm', ['run', scriptName], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: 'pipe',
  })

  return {
    status: result.status,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
  }
}

test('root workspace policy scripts pass from the repository root', async (t) => {
  const scripts = ['lint', 'lint:verify-cytoscape-rules', 'lint:blackbox-tests']

  for (const scriptName of scripts) {
    await t.test(`npm run ${scriptName}`, () => {
      const result = runNpmScript(scriptName)
      assert.equal(result.status, 0, result.output)
    })
  }
})

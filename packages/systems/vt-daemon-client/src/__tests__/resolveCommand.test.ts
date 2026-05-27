/**
 * Regression guard for the latent BF-371/BF-373 packaging gap surfaced by
 * Phase 2 Leaf A: `@vt/vt-daemon/package.json` previously did not list
 * `./bin/vtd.ts` in its `exports` field, which made the default resolver
 * (`require.resolve('@vt/vt-daemon/bin/vtd.ts')`) throw
 * ERR_PACKAGE_PATH_NOT_EXPORTED in production. The bug was hidden because
 * every test in the workspace overrode the resolver via `bin: …` or
 * `VT_DAEMON_BIN`. This test deliberately exercises the production
 * resolution path (no override, env var cleared) so any future removal of
 * the bin export trips an immediate failure.
 */

import { existsSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { describe, expect, test } from 'vitest'
import { resolveCommand, type ResolveVtDaemonCommandDeps } from '../autoLaunch/runtime.ts'

const requireFromHere = createRequire(import.meta.url)

function deps(env: NodeJS.ProcessEnv = {}): ResolveVtDaemonCommandDeps {
  return {
    env,
    runtimeCommand: () => process.execPath,
    tsxLoaderPath: requireFromHere.resolve('tsx'),
    vtdBinPath: requireFromHere.resolve('@vt/vt-daemon/bin/vtd.ts'),
  }
}

describe('resolveCommand — production-path resolution', () => {
  test('resolves @vt/vt-daemon/bin/vtd.ts via the package exports field', () => {
    const spec = resolveCommand('/tmp/some-vault', undefined, deps())

    expect(spec.cmd).toBe(process.execPath)

    const vaultIndex = spec.args.indexOf('--vault')
    expect(vaultIndex).toBeGreaterThanOrEqual(0)
    expect(spec.args[vaultIndex + 1]).toBe('/tmp/some-vault')

    const binPath = spec.args.find((a) => a.endsWith('vtd.ts'))
    expect(binPath, 'resolver must include vtd.ts path in args').toBeDefined()
    expect(existsSync(binPath as string)).toBe(true)
    expect(statSync(binPath as string).isFile()).toBe(true)
  })

  test('preserves explicit environment when resolving an override command', () => {
    const spec = resolveCommand('/tmp/some-vault', '/bin/echo fake-vtd', deps({
      PATH: '/tmp/vt-daemon-client-test-path',
    }))

    expect(spec.cmd).toBe('/bin/echo')
    expect(spec.args).toEqual(['fake-vtd', '--vault', '/tmp/some-vault'])
    expect(spec.env.PATH).toBe('/tmp/vt-daemon-client-test-path')
  })
})

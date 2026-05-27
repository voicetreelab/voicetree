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
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { resolveCommand } from '../autoLaunch/runtime.ts'

describe('resolveCommand — production-path resolution', () => {
  const originalEnv = process.env.VT_DAEMON_BIN

  beforeEach(() => {
    delete process.env.VT_DAEMON_BIN
  })

  afterEach(() => {
    if (originalEnv === undefined) delete process.env.VT_DAEMON_BIN
    else process.env.VT_DAEMON_BIN = originalEnv
  })

  test('resolves @vt/vt-daemon/bin/vtd.ts via the package exports field', () => {
    const spec = resolveCommand('/tmp/some-vault')

    expect(spec.cmd).toBe(process.execPath)

    const vaultIndex = spec.args.indexOf('--vault')
    expect(vaultIndex).toBeGreaterThanOrEqual(0)
    expect(spec.args[vaultIndex + 1]).toBe('/tmp/some-vault')

    const binPath = spec.args.find((a) => a.endsWith('vtd.ts'))
    expect(binPath, 'resolver must include vtd.ts path in args').toBeDefined()
    expect(existsSync(binPath as string)).toBe(true)
    expect(statSync(binPath as string).isFile()).toBe(true)
  })
})

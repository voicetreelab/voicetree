/**
 * Resolver tests for the vtd spawn command.
 *
 * `resolveDefaultDaemonArgs` is the production entrypoint locator: it prefers a
 * shipped sibling bundle (packaged-Electron / published-tarball layout) over a
 * workspace dist build over TS source under tsx. These cases inject synthetic
 * `DaemonEntrypointDeps` so the bundle-vs-source preference is exercised without
 * touching the real filesystem — mirroring `@vt/graph-db-client`'s
 * resolveDefaultDaemonArgs tests.
 *
 * The `--project` (never `--project-root`) argv shape is the BF-371 contract;
 * `--project-root` is graphd's. Keeping them distinct makes a misrouted
 * launcher fail loudly at parseArgs.
 */

import { describe, expect, test } from 'vitest'
import {
  resolveCommand,
  resolveDefaultDaemonArgs,
} from '../autoLaunch/runtime.ts'

const TSX = '/tmp/tsx'

describe('resolveDefaultDaemonArgs — entrypoint preference', () => {
  test('prefers the sibling bundle when one ships alongside (packaged / tarball layout)', () => {
    const sibling = '/app/Resources/app.asar.unpacked/dist-electron/main/vtd.mjs'
    const args = resolveDefaultDaemonArgs('/tmp/project', {
      exists: (path) => path === sibling,
      resolveTsx: () => TSX,
      siblingDaemonPath: () => sibling,
    })
    expect(args).toEqual([sibling, '--project', '/tmp/project'])
  })

  test('falls back to the @vt/vt-daemon dist build when no sibling ships', () => {
    const args = resolveDefaultDaemonArgs('/tmp/project', {
      exists: (path) => path.endsWith('/dist/vtd.mjs'),
      resolveTsx: () => TSX,
      siblingDaemonPath: () => undefined,
    })
    expect(args).toEqual([
      expect.stringMatching(/dist\/vtd\.mjs$/),
      '--project',
      '/tmp/project',
    ])
  })

  test('falls back to TS source under tsx in a clean source checkout', () => {
    const args = resolveDefaultDaemonArgs('/tmp/project', {
      exists: (path) => path.endsWith('/bin/vtd.ts'),
      resolveTsx: () => TSX,
      siblingDaemonPath: () => undefined,
    })
    expect(args).toEqual([
      '--import',
      TSX,
      expect.stringMatching(/bin\/vtd\.ts$/),
      '--project',
      '/tmp/project',
    ])
  })

  test('throws a clear error when no entrypoint can be located', () => {
    expect(() =>
      resolveDefaultDaemonArgs('/tmp/project', {
        exists: () => false,
        resolveTsx: () => TSX,
        siblingDaemonPath: () => '/missing/sibling/vtd.mjs',
      }),
    ).toThrow(/Could not locate vtd entrypoint/)
  })
})

describe('resolveCommand', () => {
  test('production path resolves a real entrypoint without throwing', () => {
    // No override, env cleared: exercises the default-deps resolution against
    // the real workspace so a future packaging regression (missing dist AND
    // source, or unresolvable @vt/vt-daemon) trips here.
    const spec = resolveCommand('/tmp/some-project', undefined, {
      env: {},
      runtimeCommand: () => process.execPath,
    })

    expect(spec.cmd).toBe(process.execPath)
    expect(spec.args.slice(-2)).toEqual(['--project', '/tmp/some-project'])

    const entrypoint = spec.args.find((a) => a.endsWith('vtd.mjs') || a.endsWith('vtd.ts'))
    expect(entrypoint, 'resolver must include a vtd entrypoint in args').toBeDefined()
  })

  test('preserves explicit environment when resolving an override command', () => {
    const spec = resolveCommand('/tmp/some-project', '/bin/echo fake-vtd', {
      env: { PATH: '/tmp/vt-daemon-client-test-path' },
      runtimeCommand: () => process.execPath,
    })

    expect(spec.cmd).toBe('/bin/echo')
    expect(spec.args).toEqual(['fake-vtd', '--project', '/tmp/some-project'])
    expect(spec.env.PATH).toBe('/tmp/vt-daemon-client-test-path')
  })

  test('routes VT_DAEMON_BIN env override through the same parser', () => {
    const spec = resolveCommand('/tmp/some-project', undefined, {
      env: { VT_DAEMON_BIN: '/usr/bin/fake-vtd --flag' },
      runtimeCommand: () => process.execPath,
    })

    expect(spec.cmd).toBe('/usr/bin/fake-vtd')
    expect(spec.args).toEqual(['--flag', '--project', '/tmp/some-project'])
  })
})

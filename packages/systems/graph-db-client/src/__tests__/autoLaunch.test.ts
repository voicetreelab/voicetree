import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { resolveDaemonRuntimeCommand } from '../autoLaunch.ts'
import { resolveDefaultDaemonArgs } from '../autoLaunch/runtime.ts'

describe('resolveDaemonRuntimeCommand', () => {
  test('uses the current Node executable outside Electron', () => {
    expect(
      resolveDaemonRuntimeCommand({
        env: { PATH: dirname(process.execPath) },
        execPath: process.execPath,
        versions: { node: '24.0.0' },
      }),
    ).toBe(process.execPath)
  })

  test('does not blindly use the Electron executable when launched from Electron', async () => {
    await withFakeRuntimeBin(async ({ binDir, makeRuntime }) => {
      const electron = await makeRuntime('Electron', 1)
      await makeRuntime('node', 0)

      expect(
        resolveDaemonRuntimeCommand({
          env: { PATH: binDir },
          execPath: electron,
          versions: { node: '24.0.0', electron: '38.1.2' },
        }),
      ).toBe('node')
    })
  })

  test('skips a bad npm_node_execpath candidate', async () => {
    await withFakeRuntimeBin(async ({ binDir, makeRuntime }) => {
      const electron = await makeRuntime('Electron', 1)
      const badNpmNode = await makeRuntime('bad-npm-node', 1)
      await makeRuntime('node', 0)

      expect(
        resolveDaemonRuntimeCommand({
          env: { npm_node_execpath: badNpmNode, PATH: binDir },
          execPath: electron,
          versions: { node: '24.0.0', electron: '38.1.2' },
        }),
      ).toBe('node')
    })
  })

  test('prefers VT_GRAPHD_NODE_BIN when it is valid', async () => {
    await withFakeRuntimeBin(async ({ binDir, makeRuntime }) => {
      const explicitNode = await makeRuntime('explicit-node', 0)
      const npmNode = await makeRuntime('npm-node', 0)
      await makeRuntime('node', 0)

      expect(
        resolveDaemonRuntimeCommand({
          env: {
            VT_GRAPHD_NODE_BIN: explicitNode,
            npm_node_execpath: npmNode,
            PATH: binDir,
          },
          execPath: process.execPath,
          versions: { node: '24.0.0', electron: '38.1.2' },
        }),
      ).toBe(explicitNode)
    })
  })

  test('caches runtime validation results by resolved command environment', async () => {
    await withFakeRuntimeBin(async ({ binDir }) => {
      const counter = join(binDir, 'explicit-node.count')
      const explicitNode = join(binDir, 'explicit-node')
      await writeFile(
        explicitNode,
        [
          '#!/bin/sh',
          'count=0',
          `if read count < "${counter}"; then :; fi`,
          `printf '%s\\n' "$((count + 1))" > "${counter}"`,
          'exit 0',
          '',
        ].join('\n'),
        'utf8',
      )
      await chmod(explicitNode, 0o755)

      const input = {
        env: { VT_GRAPHD_NODE_BIN: explicitNode, PATH: binDir },
        execPath: process.execPath,
        versions: { node: '24.0.0', electron: '38.1.2' },
      }

      expect(resolveDaemonRuntimeCommand(input)).toBe(explicitNode)
      expect(resolveDaemonRuntimeCommand(input)).toBe(explicitNode)
      expect((await readFile(counter, 'utf8')).trim()).toBe('1')
    })
  })

  test('throws a clear error when no candidate supports node:sqlite', async () => {
    await withFakeRuntimeBin(async ({ binDir, makeRuntime }) => {
      const electron = await makeRuntime('Electron', 1)
      const badNpmNode = await makeRuntime('bad-npm-node', 1)
      await makeRuntime('node', 1)

      expect(() =>
        resolveDaemonRuntimeCommand({
          env: { npm_node_execpath: badNpmNode, PATH: binDir },
          execPath: electron,
          versions: { node: '24.0.0', electron: '38.1.2' },
        }),
      ).toThrow(
        /Could not find a Node runtime for vt-graphd that supports node:sqlite/,
      )
    })
  })
})

describe('resolveDefaultDaemonArgs', () => {
  test('prefers the sibling-bundle daemon when one is present (published-tarball layout)', () => {
    const sibling = '/install/lib/node_modules/@voicetree/cli/dist/vt-graphd.mjs'
    const args = resolveDefaultDaemonArgs('/tmp/vault', {
      exists: (path) => path === sibling,
      resolveTsx: () => '/tmp/tsx',
      siblingDaemonPath: () => sibling,
    })

    expect(args).toEqual([sibling, '--project-root', '/tmp/vault'])
  })

  test('falls back to the @vt/graph-db-server dist build when no sibling daemon ships alongside', () => {
    const args = resolveDefaultDaemonArgs('/tmp/vault', {
      exists: (path) => path.endsWith('/dist/vt-graphd.mjs'),
      resolveTsx: () => '/tmp/tsx',
      siblingDaemonPath: () => undefined,
    })

    expect(args).toEqual([
      expect.stringMatching(/dist\/vt-graphd\.mjs$/),
      '--project-root',
      '/tmp/vault',
    ])
  })

  test('falls back to the source daemon through tsx in a clean source checkout', () => {
    const args = resolveDefaultDaemonArgs('/tmp/vault', {
      exists: (path) => path.endsWith('/bin/vt-graphd.ts'),
      resolveTsx: () => '/tmp/tsx',
      siblingDaemonPath: () => undefined,
    })

    expect(args).toEqual([
      '--import',
      '/tmp/tsx',
      expect.stringMatching(/bin\/vt-graphd\.ts$/),
      '--project-root',
      '/tmp/vault',
    ])
  })

  test('throws a clear error when no daemon entrypoint can be located', () => {
    expect(() =>
      resolveDefaultDaemonArgs('/tmp/vault', {
        exists: () => false,
        resolveTsx: () => '/tmp/tsx',
        siblingDaemonPath: () => '/missing/sibling/vt-graphd.mjs',
      }),
    ).toThrow(/Could not locate vt-graphd entrypoint/)
  })
})

// The legacy `graphd.lock` orphan-recovery test moved to
// `ensureGraphDaemonForVault.test.ts` — under the BF-344 owner protocol an
// alive lock holder without a bound port surfaces as `OwnerWaitTimeoutError`
// from the wait branch, not the older `DaemonLockHeldError`.

async function withFakeRuntimeBin(
  run: (helpers: {
    binDir: string
    makeRuntime: (name: string, exitCode: number) => Promise<string>
  }) => Promise<void>,
): Promise<void> {
  const binDir = await mkdtemp(join(tmpdir(), 'vt-graphd-runtime-test-'))

  try {
    await run({
      binDir,
      makeRuntime: async (name, exitCode) => {
        const path = join(binDir, name)
        await writeFile(
          path,
          ['#!/bin/sh', `exit ${exitCode}`, ''].join('\n'),
          'utf8',
        )
        await chmod(path, 0o755)
        return path
      },
    })
  } finally {
    await rm(binDir, { force: true, recursive: true })
  }
}

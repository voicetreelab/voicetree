import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, test } from 'vitest'

import { resolveDaemonRuntimeCommand } from './autoLaunch.ts'

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

  test('throws a clear error when no candidate can load better-sqlite3', async () => {
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
        /Could not find a Node runtime for vt-graphd that can load better-sqlite3/,
      )
    })
  })
})

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

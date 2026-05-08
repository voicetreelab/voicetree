import { spawn, type ChildProcess } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { ensureDaemon, resolveDaemonRuntimeCommand } from './autoLaunch.ts'
import { DaemonLockHeldError } from './errors.ts'

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

describe('ensureDaemon — orphan lock recovery', () => {
  let vault: string
  let fakeHolder: ChildProcess | null = null

  beforeEach(async () => {
    vault = await mkdtemp(join(tmpdir(), 'vt-graphd-orphan-test-'))
    await mkdir(join(vault, '.voicetree'), { recursive: true })
    fakeHolder = null
  })

  afterEach(async () => {
    if (fakeHolder?.pid) {
      try {
        process.kill(fakeHolder.pid, 'SIGKILL')
      } catch {
        // already gone
      }
    }
    await rm(vault, { recursive: true, force: true })
  })

  test('throws DaemonLockHeldError fast when an alive process holds the lock without serving /health', async () => {
    // An alive process whose HTTP server is dead — exactly the production
    // failure mode where the spawned vt-graphd child sees the held lock and
    // exits within milliseconds via process.exit(0).
    fakeHolder = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1e9)'], {
      detached: true,
      stdio: 'ignore',
    })
    fakeHolder.unref()
    expect(fakeHolder.pid).toBeGreaterThan(0)
    const holderPid = fakeHolder.pid!

    await writeFile(
      join(vault, '.voicetree', 'graphd.lock'),
      String(holderPid),
      { flag: 'wx' },
    )

    const start = Date.now()
    let caught: unknown
    try {
      await ensureDaemon(vault, { timeoutMs: 8000 })
    } catch (err) {
      caught = err
    }
    const elapsed = Date.now() - start

    // Bug: today this throws DaemonLaunchTimeout after ~8s.
    // Fix: should throw DaemonLockHeldError carrying the holder pid, well
    // under the configured timeout.
    expect(caught).toBeInstanceOf(DaemonLockHeldError)
    expect((caught as DaemonLockHeldError).pid).toBe(holderPid)
    expect((caught as DaemonLockHeldError).vault).toBe(vault)
    expect(elapsed).toBeLessThan(5000)
  }, 15_000)
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

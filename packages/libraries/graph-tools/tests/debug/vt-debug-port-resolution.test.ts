import { execFileSync } from 'node:child_process'
import { createServer, type RequestListener } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import type { DebugInstance } from '../../src/debug/protocol/discover'
import {
  CDP_LOOPBACK_HOST,
  probeCdpPort,
  resolveDebugInstance,
  type LaunchedChild,
  type ResolveDebugInstanceDeps,
} from '../../src/debug/protocol/portResolution'
import { parseArgs as parseScreenshotArgs } from '../../src/commands/session/screenshot'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(testDir, '../../../../..')

function buildInstance(overrides: Partial<DebugInstance> = {}): DebugInstance {
  return {
    pid: 4242,
    projectRoot: '/tmp/example-project',
    cdpPort: 9222,
    startedAt: '2026-04-20T00:00:00.000Z',
    ...overrides,
  }
}

function buildDeps(overrides: Partial<ResolveDebugInstanceDeps> = {}) {
  return {
    allocatePort: vi.fn(async () => 9333),
    launchDevSession: vi.fn(async (): Promise<LaunchedChild> => ({ exited: false, exitCode: null, output: [] })),
    listInstances: vi.fn(async () => [] as DebugInstance[]),
    now: vi.fn(() => 0),
    probeCdpPort: vi.fn(async () => true),
    sleep: vi.fn(async () => undefined),
    stderr: {
      write: vi.fn(() => true),
    },
    ...overrides,
  }
}

async function withProbeServer(
  handler: RequestListener,
  run: (port: number) => Promise<void>,
): Promise<void> {
  const server = createServer(handler)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, CDP_LOOPBACK_HOST, resolve)
  })

  try {
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('server did not bind to a TCP port')
    }
    await run(address.port)
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve())
    })
  }
}

describe('probeCdpPort', () => {
  it('accepts a CDP /json/version endpoint on the IPv4 loopback host', async () => {
    await withProbeServer((request, response) => {
      if (request.url !== '/json/version') {
        response.writeHead(404).end()
        return
      }

      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        Browser: 'Chrome/140.0.7339.133',
        webSocketDebuggerUrl: 'ws://127.0.0.1/devtools/browser/test',
      }))
    }, async (port) => {
      expect(await probeCdpPort(port)).toBe(true)
    })
  })
})

describe('resolveDebugInstance', () => {
  it('warns when a session exists and no selector given', async () => {
    const instance = buildInstance()
    const deps = buildDeps({
      listInstances: vi.fn(async () => [instance]),
    })

    const result = await resolveDebugInstance({}, deps)

    expect(result).toMatchObject({
      ok: false,
      message: 'existing dev session found (9222)',
    })
    expect(deps.launchDevSession).not.toHaveBeenCalled()
  })

  it('reuses session when targeted with --port', async () => {
    const instance = buildInstance()
    const deps = buildDeps({
      listInstances: vi.fn(async () => [instance]),
    })

    const result = await resolveDebugInstance({ port: 9222 }, deps)

    expect(result).toEqual({ ok: true, instance })
    expect(deps.probeCdpPort).toHaveBeenCalledWith(instance.cdpPort)
    expect(deps.launchDevSession).not.toHaveBeenCalled()
  })

  it('launches fresh session with --new even when one exists', async () => {
    const existing = buildInstance({ pid: 1111, cdpPort: 9222 })
    const launched = buildInstance({ pid: 5252, cdpPort: 9333 })
    const deps = buildDeps({
      allocatePort: vi.fn(async () => launched.cdpPort),
      listInstances: vi
        .fn<() => Promise<DebugInstance[]>>()
        .mockResolvedValueOnce([existing])
        .mockResolvedValueOnce([existing, launched]),
    })

    const result = await resolveDebugInstance({ forceNew: true }, deps)

    expect(result).toEqual({ ok: true, instance: launched })
    expect(deps.launchDevSession).toHaveBeenCalledWith(launched.cdpPort)
  })

  it('auto-launches a dev session on a free port when no registered instances exist', async () => {
    const launched = buildInstance({ pid: 5252, cdpPort: 9333 })
    const deps = buildDeps({
      allocatePort: vi.fn(async () => launched.cdpPort),
      listInstances: vi
        .fn<() => Promise<DebugInstance[]>>()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([launched]),
    })

    const result = await resolveDebugInstance({}, deps)

    expect(result).toEqual({ ok: true, instance: launched })
    expect(deps.launchDevSession).toHaveBeenCalledWith(launched.cdpPort)
    expect(deps.stderr.write).toHaveBeenCalledWith(
      `[vt-debug] launched new dev session on port ${launched.cdpPort} — re-run with --port ${launched.cdpPort} for future commands\n`,
    )
  })

  it('warns when multiple dev instances are running', async () => {
    const deps = buildDeps({
      listInstances: vi.fn(async () => [
        buildInstance({ pid: 1111, cdpPort: 9222 }),
        buildInstance({ pid: 2222, cdpPort: 9333 }),
      ]),
    })

    const result = await resolveDebugInstance({}, deps)

    expect(result).toMatchObject({
      ok: false,
      message: 'existing dev sessions found (9222, 9333)',
    })
    expect(deps.probeCdpPort).not.toHaveBeenCalled()
    expect(deps.launchDevSession).not.toHaveBeenCalled()
  })
})

describe('vt-debug CLI surface', () => {
  it('accepts --cdpPort as a backward-compatible alias in screenshot args', () => {
    expect(parseScreenshotArgs(['--cdpPort', '9777']).port).toBe(9777)
  })

  it('documents shared --port usage and auto-launch in --help output', () => {
    const stdout = execFileSync(
      process.execPath,
      ['--import', 'tsx', 'packages/libraries/graph-tools/bin/vt-debug.ts', '--help'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    )

    expect(stdout).toContain('Usage: vt debug <command> [args]')
    expect(stdout).toContain('--port <N>')
    expect(stdout).toContain('--cdpPort <N>')
    expect(stdout).toContain('Auto-launch:')
    expect(stdout).toContain('Only registered dev sessions with a live /json/version endpoint are considered')
  })
})

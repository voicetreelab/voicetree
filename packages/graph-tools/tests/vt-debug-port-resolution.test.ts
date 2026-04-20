import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import type { DebugInstance } from '../src/debug/discover'
import { resolveDebugInstance, type ResolveDebugInstanceDeps } from '../src/debug/portResolution'
import { parseArgs as parseScreenshotArgs } from '../src/commands/screenshot'

const testDir = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(testDir, '../../..')

function buildInstance(overrides: Partial<DebugInstance> = {}): DebugInstance {
  return {
    pid: 4242,
    vaultPath: '/tmp/example-vault',
    mcpPort: 3100,
    cdpPort: 9222,
    startedAt: '2026-04-20T00:00:00.000Z',
    ...overrides,
  }
}

function buildDeps(overrides: Partial<ResolveDebugInstanceDeps> = {}) {
  return {
    allocatePort: vi.fn(async () => 9333),
    launchDevSession: vi.fn(async () => undefined),
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

describe('resolveDebugInstance', () => {
  it('reuses the only registered dev instance silently when its CDP endpoint responds', async () => {
    const instance = buildInstance()
    const deps = buildDeps({
      listInstances: vi.fn(async () => [instance]),
    })

    const result = await resolveDebugInstance({}, deps)

    expect(result).toEqual({ ok: true, instance })
    expect(deps.probeCdpPort).toHaveBeenCalledWith(instance.cdpPort)
    expect(deps.launchDevSession).not.toHaveBeenCalled()
    expect(deps.stderr.write).not.toHaveBeenCalled()
  })

  it('auto-launches a dev session on a free port when no registered instances exist', async () => {
    const launched = buildInstance({ pid: 5252, mcpPort: 3200, cdpPort: 9333 })
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

  it('requires --port when multiple dev instances are running', async () => {
    const deps = buildDeps({
      listInstances: vi.fn(async () => [
        buildInstance({ pid: 1111, cdpPort: 9222 }),
        buildInstance({ pid: 2222, cdpPort: 9333 }),
      ]),
    })

    const result = await resolveDebugInstance({}, deps)

    expect(result).toMatchObject({
      ok: false,
      message: '--port required (multiple dev instances running: 9222, 9333)',
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
      ['--import', 'tsx', 'packages/graph-tools/bin/vt-debug.ts', '--help'],
      {
        cwd: repoRoot,
        encoding: 'utf8',
      },
    )

    expect(stdout).toContain('Usage: vt-debug <command> [args]')
    expect(stdout).toContain('--port <N>')
    expect(stdout).toContain('--cdpPort <N>')
    expect(stdout).toContain('Auto-launch:')
    expect(stdout).toContain('Only registered dev sessions with a live /json/version endpoint are considered')
  })
})

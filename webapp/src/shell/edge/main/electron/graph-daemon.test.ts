import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

type MockClient = {
  baseUrl: string
  health: ReturnType<typeof vi.fn>
}

const mockState = vi.hoisted(() => {
  const state = {
    ensureDaemonMock: vi.fn(),
    clientInstances: [] as MockClient[],
    createMockClient: ((baseUrl: string) => ({
      baseUrl,
      health: vi.fn(),
    })) as (baseUrl: string) => MockClient,
    GraphDbClientMock: vi.fn(),
  }

  state.GraphDbClientMock.mockImplementation(
    ({ baseUrl }: { baseUrl: string }) => {
      const client = state.createMockClient(baseUrl)
      state.clientInstances.push(client)
      return client
    },
  )

  return state
})

vi.mock('@vt/graph-db-client', () => ({
  ensureDaemon: mockState.ensureDaemonMock,
  GraphDbClient: mockState.GraphDbClientMock,
}))

import {
  clearDaemonClientCache,
  ensureDaemonClientForVault,
  getActiveDaemonConnection,
} from './graph-daemon'

async function makeVault(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix))
  const vault = join(root, 'vault')
  await mkdir(vault, { recursive: true })
  return vault
}

describe('graph-daemon bootstrap cache', () => {
  const rootsToDelete: string[] = []

  beforeEach(() => {
    clearDaemonClientCache()
    mockState.clientInstances.length = 0
    mockState.ensureDaemonMock.mockReset()
    mockState.GraphDbClientMock.mockClear()
    mockState.createMockClient = (baseUrl: string) => ({
      baseUrl,
      health: vi.fn(),
    })
  })

  afterEach(async () => {
    clearDaemonClientCache()
    await Promise.all(
      rootsToDelete.splice(0).map((root) =>
        rm(root, { recursive: true, force: true }),
      ),
    )
  })

  test('throws an explicit error when the vault path is missing', async () => {
    const missingVault = resolve(join(tmpdir(), 'graph-daemon-missing-vault'))
    await expect(ensureDaemonClientForVault(missingVault)).rejects.toThrow(
      `Vault does not exist: ${missingVault}`,
    )
  })

  test('reuses a healthy cached client for the same vault', async () => {
    const vault = await makeVault('graph-daemon-cache-')
    rootsToDelete.push(resolve(vault, '..'))

    mockState.ensureDaemonMock.mockResolvedValue({
      port: 43123,
      pid: 123,
      launched: false,
    })
    mockState.createMockClient = (baseUrl: string) => ({
      baseUrl,
      health: vi.fn().mockResolvedValue({ vault: resolve(vault) }),
    })

    const first = await ensureDaemonClientForVault(vault)
    const second = await ensureDaemonClientForVault(vault)

    expect(mockState.ensureDaemonMock).toHaveBeenCalledTimes(1)
    expect(mockState.GraphDbClientMock).toHaveBeenCalledTimes(1)
    expect(second).toBe(first)
    expect(getActiveDaemonConnection()).toBe(first)
  })

  test('rebuilds the cached client when the old connection is no longer healthy', async () => {
    const vault = await makeVault('graph-daemon-rebuild-')
    rootsToDelete.push(resolve(vault, '..'))

    mockState.ensureDaemonMock
      .mockResolvedValueOnce({
        port: 43123,
        pid: 123,
        launched: false,
      })
      .mockResolvedValueOnce({
        port: 43124,
        pid: 456,
        launched: true,
      })

    mockState.createMockClient = (baseUrl: string) => {
      if (baseUrl.endsWith(':43123')) {
        return {
          baseUrl,
          health: vi
            .fn()
            .mockResolvedValueOnce({ vault: resolve(vault) })
            .mockRejectedValueOnce(new Error('stale client')),
        }
      }

      return {
        baseUrl,
        health: vi.fn().mockResolvedValue({ vault: resolve(vault) }),
      }
    }

    const first = await ensureDaemonClientForVault(vault)
    const second = await ensureDaemonClientForVault(vault)

    expect(mockState.ensureDaemonMock).toHaveBeenCalledTimes(2)
    expect(mockState.GraphDbClientMock).toHaveBeenCalledTimes(2)
    expect(first.port).toBe(43123)
    expect(second.port).toBe(43124)
  })
})

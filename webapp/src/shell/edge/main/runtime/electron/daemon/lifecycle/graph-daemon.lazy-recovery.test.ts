import { afterEach, describe, expect, test, vi } from 'vitest'

const graphDbClientMock = vi.hoisted(() => ({
  ensureCalls: [] as { vault: string; caller: string }[],
  ensureResults: [] as unknown[],
  ensureGraphDaemonForVault: async (vault: string, caller: string): Promise<unknown> => {
    graphDbClientMock.ensureCalls.push({ vault, caller })
    const nextResult: unknown | undefined = graphDbClientMock.ensureResults.shift()
    if (nextResult === undefined) {
      throw new Error('No fake daemon owner queued for ensureGraphDaemonForVault')
    }
    return nextResult
  },
}))

const rendererMock = vi.hoisted(() => ({
  sends: [] as { channel: string; payload: unknown }[],
  send: (channel: string, payload: unknown): void => {
    rendererMock.sends.push({ channel, payload })
  },
}))

const loopMock = vi.hoisted(() => ({
  events: [] as string[],
  unsubscribeFromDaemonSSE: (): void => {
    loopMock.events.push('unsubscribe-sse')
  },
  stopDaemonGraphSync: (): void => {
    loopMock.events.push('stop-watch-sync')
  },
}))

vi.mock('@vt/graph-db-client', () => ({
  GraphDbClient: class GraphDbClient {},
  ensureGraphDaemonForVault: graphDbClientMock.ensureGraphDaemonForVault,
}))

vi.mock('@/shell/edge/main/runtime/state/app-electron-state', () => ({
  getMainWindow: () => ({
    isDestroyed: () => false,
    webContents: {
      send: rendererMock.send,
    },
  }),
}))

vi.mock('@/shell/edge/main/runtime/electron/daemon/sync/daemon-sse-subscription', () => ({
  unsubscribeFromDaemonSSE: loopMock.unsubscribeFromDaemonSSE,
}))

vi.mock('@/shell/edge/main/runtime/electron/daemon/sync/daemon-watch-sync', () => ({
  stopDaemonGraphSync: loopMock.stopDaemonGraphSync,
}))

import type { EnsureGraphDaemonResult, GraphDbClient } from '@vt/graph-db-client'
import {
  callDaemon,
  clearDaemonClientCache,
  setActiveVaultAndEnsureDaemon,
  shutdownActiveDaemonConnection,
} from './graph-daemon'

type FakeClient = GraphDbClient & {
  readonly health: ReturnType<typeof vi.fn>
}

const VAULT = '/tmp/fake-vault-for-lazy-recovery'

function connectionFailure(): Error {
  return new Error('fetch failed')
}

function makeOwner(pid: number): EnsureGraphDaemonResult {
  return {
    client: {
      health: vi.fn(async () => ({ ok: true })),
    } as unknown as FakeClient,
    pid,
    port: 40_000 + pid,
    ownerNonce: `owner-${pid}`,
    launched: pid !== 1,
  }
}

describe('callDaemon lazy daemon recovery', () => {
  afterEach(async () => {
    await shutdownActiveDaemonConnection().catch(() => undefined)
    clearDaemonClientCache()
    graphDbClientMock.ensureCalls.splice(0)
    graphDbClientMock.ensureResults.splice(0)
    rendererMock.sends.splice(0)
    loopMock.events.splice(0)
  })

  test('trusts cached owner without a per-call health probe', async () => {
    const owner = makeOwner(1)
    graphDbClientMock.ensureResults.push(owner)

    await setActiveVaultAndEnsureDaemon(VAULT)
    const first = await callDaemon(async (client) => client)
    const second = await callDaemon(async (client) => client)

    expect(first).toBe(owner.client)
    expect(second).toBe(owner.client)
    expect(owner.client.health).not.toHaveBeenCalled()
    expect(graphDbClientMock.ensureCalls).toEqual([{ vault: VAULT, caller: 'electron-main' }])
  })

  test('recovers and retries the failed RPC once after cached daemon loss', async () => {
    const lostOwner = makeOwner(1)
    const recoveredOwner = makeOwner(2)
    graphDbClientMock.ensureResults.push(lostOwner, recoveredOwner)

    await setActiveVaultAndEnsureDaemon(VAULT)

    const seenClients: GraphDbClient[] = []
    const result = await callDaemon(async (client) => {
      seenClients.push(client)
      if (client === lostOwner.client) {
        throw connectionFailure()
      }
      return 'recovered'
    })

    expect(result).toBe('recovered')
    expect(seenClients).toEqual([lostOwner.client, recoveredOwner.client])
    expect(graphDbClientMock.ensureCalls).toEqual([
      { vault: VAULT, caller: 'electron-main' },
      { vault: VAULT, caller: 'electron-main' },
    ])
    expect(loopMock.events).toEqual(['unsubscribe-sse', 'stop-watch-sync'])
  })
})

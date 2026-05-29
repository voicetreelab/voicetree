import { describe, expect, test } from 'vitest'

import { DaemonUnreachableError } from '../errors.ts'
import { discoverPort, type PortDiscoveryDeps } from '../portDiscovery.ts'

function portDiscoveryDeps(
  overrides: Partial<PortDiscoveryDeps> = {},
): PortDiscoveryDeps {
  return {
    now: () => 0,
    readPortFile: async () => null,
    lockFileExists: () => false,
    sleep: async () => undefined,
    ...overrides,
  }
}

describe('discoverPort', () => {
  test('fails immediately when neither the port file nor daemon lock exists', async () => {
    await expect(
      discoverPort(
        '/tmp/project',
        { timeoutMs: 5000 },
        portDiscoveryDeps({
          sleep: async () => {
            throw new Error('should not sleep without a daemon lock')
          },
        }),
      ),
    ).rejects.toBeInstanceOf(DaemonUnreachableError)
  })

  test('polls for a port file while a daemon lock exists', async () => {
    let currentTimeMs = 0
    let portAvailable = false

    await expect(
      discoverPort(
        '/tmp/project',
        { timeoutMs: 500 },
        portDiscoveryDeps({
          now: () => currentTimeMs,
          lockFileExists: () => true,
          readPortFile: async () => (portAvailable ? 41000 : null),
          sleep: async (ms: number) => {
            currentTimeMs += ms
            portAvailable = true
          },
        }),
      ),
    ).resolves.toBe(41000)
  })
})

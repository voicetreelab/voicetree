/**
 * BF-347 black-box tests for Electron owner-mediated recovery.
 *
 * The Electron wrapper's job is intentionally narrow:
 *   - stop stale SSE/watch-sync loops before owner recovery;
 *   - delegate recovery to `ensureGraphDaemonForVault`;
 *   - surface typed owner-path suppression errors unchanged.
 *
 * The load-bearing fork-storm bounds live in @vt/graph-db-client:
 * in-process single-flight, cross-process spawn lock, and cooldown
 * breadcrumb coverage are asserted by that package's black-box tests.
 */

import { describe, expect, test } from 'vitest'

import {
  OwnerSpawnCooldownError,
  type EnsureGraphDaemonResult,
  type GraphDbClient,
} from '@vt/graph-db-client'
import { attemptOwnerMediatedRecovery } from './graph-daemon-recovery'

const VAULT = '/tmp/fake-vault-for-bf347-recovery-tests'

function makeFakeOwner(): EnsureGraphDaemonResult {
  return {
    client: { health: async () => ({}) } as unknown as GraphDbClient,
    pid: 1234,
    port: 4567,
    ownerNonce: 'nonce',
    launched: true,
  }
}

describe('attemptOwnerMediatedRecovery', () => {
  test('stops loops before calling the owner ensure path', async () => {
    const sequence: string[] = []
    const result = await attemptOwnerMediatedRecovery(VAULT, 'electron-main', {
      stopLoops: async () => {
        sequence.push('stop-loops')
      },
      ensureFn: async (vault) => {
        sequence.push(`ensure(${vault})`)
        return makeFakeOwner()
      },
    })

    expect(sequence).toEqual(['stop-loops', `ensure(${VAULT})`])
    expect(result.pid).toBe(1234)
    expect(result.port).toBe(4567)
    expect(result.ownerNonce).toBe('nonce')
  })

  test('passes the canonical vault and caller kind to the owner ensure path', async () => {
    const observed: string[] = []

    await attemptOwnerMediatedRecovery(VAULT, 'electron-main', {
      ensureFn: async (vault, caller) => {
        observed.push(`${caller}:${vault}`)
        return makeFakeOwner()
      },
    })

    expect(observed).toEqual([`electron-main:${VAULT}`])
  })

  test('surfaces owner cooldown suppression unchanged after stopping loops', async () => {
    const sequence: string[] = []
    const error = new OwnerSpawnCooldownError(
      VAULT,
      1_000_000,
      'spawn-failed',
    )

    await expect(
      attemptOwnerMediatedRecovery(VAULT, 'electron-main', {
        stopLoops: () => {
          sequence.push('stop-loops')
        },
        ensureFn: async () => {
          sequence.push('ensure')
          throw error
        },
      }),
    ).rejects.toBe(error)

    expect(sequence).toEqual(['stop-loops', 'ensure'])
  })
})

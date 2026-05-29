/**
 * BF-347 black-box tests for Electron owner-mediated recovery.
 *
 * The Electron wrapper's job is intentionally narrow:
 *   - stop stale SSE/watch-sync loops before owner recovery;
 *   - delegate recovery to `ensureGraphDaemonForProject`;
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

const PROJECT = '/tmp/fake-project-for-bf347-recovery-tests'

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
    const result = await attemptOwnerMediatedRecovery(PROJECT, 'electron-main', {
      stopLoops: async () => {
        sequence.push('stop-loops')
      },
      ensureFn: async (project) => {
        sequence.push(`ensure(${project})`)
        return makeFakeOwner()
      },
    })

    expect(sequence).toEqual(['stop-loops', `ensure(${PROJECT})`])
    expect(result.pid).toBe(1234)
    expect(result.port).toBe(4567)
    expect(result.ownerNonce).toBe('nonce')
  })

  test('passes the canonical project and caller kind to the owner ensure path', async () => {
    const observed: string[] = []

    await attemptOwnerMediatedRecovery(PROJECT, 'electron-main', {
      ensureFn: async (project, caller) => {
        observed.push(`${caller}:${project}`)
        return makeFakeOwner()
      },
    })

    expect(observed).toEqual([`electron-main:${PROJECT}`])
  })

  test('surfaces owner cooldown suppression unchanged after stopping loops', async () => {
    const sequence: string[] = []
    const error = new OwnerSpawnCooldownError(
      PROJECT,
      1_000_000,
      'spawn-failed',
    )

    await expect(
      attemptOwnerMediatedRecovery(PROJECT, 'electron-main', {
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

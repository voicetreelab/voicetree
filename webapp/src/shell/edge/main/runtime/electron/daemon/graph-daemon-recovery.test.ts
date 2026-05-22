/**
 * BF-347 black-box tests for bounded Electron recovery.
 *
 * Asserts on observable behaviour:
 *   - decideRecoveryAttempt is pure and bounded.
 *   - attemptBoundedRecovery stops loops BEFORE the ensure call.
 *   - Recovery is capped at N attempts inside the window; further
 *     attempts throw RecoveryExhaustedError and DO NOT call ensure.
 *   - Old attempts age out of the window so retries become possible.
 *
 * No internal mocks beyond the public `ensureFn` and `stopLoops`
 * injection points the production code already accepts.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { EnsureGraphDaemonResult, GraphDbClient } from '@vt/graph-db-client'
import {
  __resetAllRecoveryHistoryForTest,
  attemptBoundedRecovery,
  decideRecoveryAttempt,
  RecoveryExhaustedError,
  resetRecoveryHistory,
} from './graph-daemon-recovery'

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

beforeEach(() => {
  __resetAllRecoveryHistoryForTest()
})

afterEach(() => {
  __resetAllRecoveryHistoryForTest()
})

describe('decideRecoveryAttempt — pure', () => {
  test('allows the first attempt regardless of history', () => {
    expect(
      decideRecoveryAttempt(100, [], { maxAttempts: 3, windowMs: 30_000 }),
    ).toBe('allowed')
  })

  test('allows attempts while under cap', () => {
    expect(
      decideRecoveryAttempt(100, [10, 50], {
        maxAttempts: 3,
        windowMs: 30_000,
      }),
    ).toBe('allowed')
  })

  test('suppresses when cap reached inside window', () => {
    expect(
      decideRecoveryAttempt(100, [10, 50, 90], {
        maxAttempts: 3,
        windowMs: 30_000,
      }),
    ).toBe('suppressed')
  })

  test('old attempts outside the window do not count', () => {
    const policy = { maxAttempts: 3, windowMs: 100 }
    // nowMs=1000, window starts at 900. Two attempts before 900, one inside.
    expect(
      decideRecoveryAttempt(1_000, [100, 500, 950], policy),
    ).toBe('allowed')
  })

  test('boundary: attempt exactly at cutoff is outside the window', () => {
    const policy = { maxAttempts: 1, windowMs: 100 }
    // cutoff = 1000 - 100 = 900. A timestamp of 900 is NOT > cutoff,
    // so it falls outside.
    expect(decideRecoveryAttempt(1_000, [900], policy)).toBe('allowed')
  })
})

describe('attemptBoundedRecovery — stop loops + bounded ensure', () => {
  test('stops loops BEFORE calling ensure', async () => {
    const sequence: string[] = []
    const result = await attemptBoundedRecovery(VAULT, 'electron-main', {
      stopLoops: async () => {
        sequence.push('stop-loops')
      },
      ensureFn: async (vault) => {
        sequence.push(`ensure(${vault})`)
        return makeFakeOwner()
      },
      maxAttempts: 3,
      windowMs: 30_000,
    })

    expect(sequence).toEqual(['stop-loops', `ensure(${VAULT})`])
    expect(result.pid).toBe(1234)
  })

  test('caps attempts at N inside the window and throws RecoveryExhaustedError without calling ensure on the (N+1)th', async () => {
    let ensureCalls = 0
    const policy = { maxAttempts: 3, windowMs: 30_000 }
    let now = 1_000_000

    const opts = {
      stopLoops: () => undefined,
      ensureFn: async (): Promise<EnsureGraphDaemonResult> => {
        ensureCalls += 1
        return makeFakeOwner()
      },
      maxAttempts: policy.maxAttempts,
      windowMs: policy.windowMs,
      now: () => now,
    }

    // Three permitted attempts.
    await attemptBoundedRecovery(VAULT, 'electron-main', opts)
    now += 100
    await attemptBoundedRecovery(VAULT, 'electron-main', opts)
    now += 100
    await attemptBoundedRecovery(VAULT, 'electron-main', opts)
    expect(ensureCalls).toBe(3)

    // Fourth inside the same 30s window is suppressed.
    now += 100
    await expect(
      attemptBoundedRecovery(VAULT, 'electron-main', opts),
    ).rejects.toBeInstanceOf(RecoveryExhaustedError)
    expect(ensureCalls).toBe(3) // ensure was NOT called again
  })

  test('attempts that fall out of the window free up the budget', async () => {
    let ensureCalls = 0
    let now = 1_000_000
    const opts = {
      stopLoops: () => undefined,
      ensureFn: async (): Promise<EnsureGraphDaemonResult> => {
        ensureCalls += 1
        return makeFakeOwner()
      },
      maxAttempts: 2,
      windowMs: 1_000,
      now: () => now,
    }

    await attemptBoundedRecovery(VAULT, 'electron-main', opts)
    await attemptBoundedRecovery(VAULT, 'electron-main', opts)
    expect(ensureCalls).toBe(2)

    // Third call inside window is suppressed.
    await expect(
      attemptBoundedRecovery(VAULT, 'electron-main', opts),
    ).rejects.toBeInstanceOf(RecoveryExhaustedError)

    // Advance past the window — earlier attempts age out, ensure runs again.
    now += 2_000
    await attemptBoundedRecovery(VAULT, 'electron-main', opts)
    expect(ensureCalls).toBe(3)
  })

  test('resetRecoveryHistory clears the bound for that vault', async () => {
    let ensureCalls = 0
    let now = 1_000_000
    const opts = {
      stopLoops: () => undefined,
      ensureFn: async (): Promise<EnsureGraphDaemonResult> => {
        ensureCalls += 1
        return makeFakeOwner()
      },
      maxAttempts: 1,
      windowMs: 30_000,
      now: () => now,
    }

    await attemptBoundedRecovery(VAULT, 'electron-main', opts)
    await expect(
      attemptBoundedRecovery(VAULT, 'electron-main', opts),
    ).rejects.toBeInstanceOf(RecoveryExhaustedError)
    expect(ensureCalls).toBe(1)

    resetRecoveryHistory(VAULT)

    await attemptBoundedRecovery(VAULT, 'electron-main', opts)
    expect(ensureCalls).toBe(2)
  })

  test('different vaults have independent budgets', async () => {
    let ensureCalls = 0
    const opts = {
      stopLoops: () => undefined,
      ensureFn: async (): Promise<EnsureGraphDaemonResult> => {
        ensureCalls += 1
        return makeFakeOwner()
      },
      maxAttempts: 1,
      windowMs: 30_000,
    }

    await attemptBoundedRecovery('/tmp/vault-a', 'electron-main', opts)
    await attemptBoundedRecovery('/tmp/vault-b', 'electron-main', opts)
    expect(ensureCalls).toBe(2)

    await expect(
      attemptBoundedRecovery('/tmp/vault-a', 'electron-main', opts),
    ).rejects.toBeInstanceOf(RecoveryExhaustedError)
  })

  test('stopLoops runs even when recovery is suppressed (so loops stay stopped)', async () => {
    let stopCount = 0
    const opts = {
      stopLoops: () => {
        stopCount += 1
      },
      ensureFn: async (): Promise<EnsureGraphDaemonResult> => makeFakeOwner(),
      maxAttempts: 1,
      windowMs: 30_000,
    }

    await attemptBoundedRecovery(VAULT, 'electron-main', opts)
    expect(stopCount).toBe(1)

    await expect(
      attemptBoundedRecovery(VAULT, 'electron-main', opts),
    ).rejects.toBeInstanceOf(RecoveryExhaustedError)
    // Loops were stopped a second time before the suppressed decision —
    // ensuring SSE + watch-sync don't keep retrying while the budget is
    // exhausted.
    expect(stopCount).toBe(2)
  })
})

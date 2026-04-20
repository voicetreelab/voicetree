import { describe, expect, it, vi } from 'vitest'

import { deriveFlowRuntimeContext } from '../src/debug/flows/index'
import { waitForLiveStateWithRoots } from '../src/debug/waitForLiveRoots'

function stateWithRoots(loaded: readonly string[]) {
  return {
    roots: {
      loaded: new Set(loaded),
      folderTree: [],
    },
    graph: {
      nodes: {
        '/tmp/vault/a.md': {},
      },
    },
  }
}

describe('waitForLiveStateWithRoots', () => {
  it('returns immediately when the first live snapshot already has a loaded root', async () => {
    const getLiveState = vi.fn().mockResolvedValue(stateWithRoots(['/tmp/vault']))
    const sleep = vi.fn()

    const result = await waitForLiveStateWithRoots({ getLiveState }, { sleep })

    expect(result.roots.loaded.has('/tmp/vault')).toBe(true)
    expect(getLiveState).toHaveBeenCalledTimes(1)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries through startup errors and empty snapshots until roots load', async () => {
    const getLiveState = vi.fn()
      .mockRejectedValueOnce(new Error('ECONNREFUSED'))
      .mockResolvedValueOnce(stateWithRoots([]))
      .mockResolvedValueOnce(stateWithRoots(['/tmp/vault']))
    const sleep = vi.fn(async () => undefined)

    const result = await waitForLiveStateWithRoots(
      { getLiveState },
      { sleep, timeoutMs: 1_000, pollMs: 10 },
    )

    expect(result.roots.loaded.has('/tmp/vault')).toBe(true)
    expect(getLiveState).toHaveBeenCalledTimes(3)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('returns the last empty snapshot on timeout so callers preserve the legacy error', async () => {
    const getLiveState = vi.fn().mockResolvedValue(stateWithRoots([]))

    const result = await waitForLiveStateWithRoots(
      { getLiveState },
      { timeoutMs: 0, pollMs: 0 },
    )

    expect(() => deriveFlowRuntimeContext(result as never)).toThrow('live state has no loaded roots')
  })
})

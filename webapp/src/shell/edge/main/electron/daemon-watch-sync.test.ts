import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockRefreshMainGraphFromDaemon = vi.fn()

vi.mock('./daemon-ipc-proxy', () => ({
  refreshMainGraphFromDaemon: mockRefreshMainGraphFromDaemon,
}))

describe('daemon watch sync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    mockRefreshMainGraphFromDaemon.mockResolvedValue(undefined)
  })

  afterEach(async () => {
    const module = await import('./daemon-watch-sync')
    await module.stopDaemonGraphSync()
    vi.useRealTimers()
  })

  it('polls the daemon after the initial sync', async () => {
    const module = await import('./daemon-watch-sync')

    await module.startDaemonGraphSync('/vault')
    expect(mockRefreshMainGraphFromDaemon).toHaveBeenCalledTimes(1)
    expect(mockRefreshMainGraphFromDaemon).toHaveBeenLastCalledWith('/vault')

    await vi.advanceTimersByTimeAsync(750)

    expect(mockRefreshMainGraphFromDaemon).toHaveBeenCalledTimes(2)
    expect(mockRefreshMainGraphFromDaemon).toHaveBeenLastCalledWith('/vault')
  })

  it('stops polling after teardown', async () => {
    const module = await import('./daemon-watch-sync')

    await module.startDaemonGraphSync('/vault')
    await module.stopDaemonGraphSync()

    await vi.advanceTimersByTimeAsync(2_000)

    expect(mockRefreshMainGraphFromDaemon).toHaveBeenCalledTimes(1)
  })
})

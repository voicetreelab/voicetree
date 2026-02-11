/**
 * Unit tests for rpc-handler.ts
 * Tests the RPC infrastructure for zero-boilerplate IPC communication
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

// Mock dependencies
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockIpcMainHandle: Mock<(...args: any[]) => any> = vi.fn()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetGraph: Mock<(...args: any[]) => any> = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcMainHandle,
  },
}))

vi.mock('@/shell/edge/main/api', () => ({
  mainAPI: {
    getGraph: mockGetGraph,
  },
}))

// Helper to extract the registered RPC handler
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getRegisteredHandler(): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handlerCall: any[] | undefined = mockIpcMainHandle.mock.calls.find(call => call[0] === 'rpc:call') as any[] | undefined
  return handlerCall?.[1]
}

describe('setupRPCHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should register IPC handler for rpc:call channel', async () => {
    const { setupRPCHandlers } = await import('./rpc-handler')

    setupRPCHandlers()

    expect(mockIpcMainHandle).toHaveBeenCalledWith('rpc:call', expect.any(Function))
  })

  it('should throw error when function does not exist in mainAPI', async () => {
    const { setupRPCHandlers } = await import('./rpc-handler')

    setupRPCHandlers()

    const handler: (...args: unknown[]) => Promise<unknown> = getRegisteredHandler()

    await expect(handler({}, 'nonExistentFunction', [])).rejects.toThrow('Function not found: nonExistentFunction')
  })

  it('should re-throw promise rejections for Error and non-Error values', async () => {
    const { setupRPCHandlers } = await import('./rpc-handler')

    setupRPCHandlers()

    const handler: (...args: unknown[]) => Promise<unknown> = getRegisteredHandler()

    // Test promise rejection with Error object — re-thrown as-is
    const testError: Error = new Error('Test error')
    mockGetGraph.mockRejectedValue(testError)
    await expect(handler({}, 'getGraph', [])).rejects.toThrow('Test error')

    // Test promise rejection with non-Error value — wrapped in Error
    mockGetGraph.mockRejectedValue('String error')
    await expect(handler({}, 'getGraph', [])).rejects.toThrow('String error')
  })
})

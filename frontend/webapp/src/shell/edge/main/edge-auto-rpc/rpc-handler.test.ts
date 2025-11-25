/**
 * Unit tests for rpc-handler.ts
 * Tests the RPC infrastructure for zero-boilerplate IPC communication
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock dependencies
const mockIpcMainHandle = vi.fn()
const mockApplyGraphDeltaToDB = vi.fn()
const mockGetGraph = vi.fn()
const mockLoadSettings = vi.fn()
const mockSaveSettings = vi.fn()

vi.mock('electron', () => ({
  ipcMain: {
    handle: mockIpcMainHandle,
  },
}))

vi.mock('@/shell/edge/main/api', () => ({
  mainAPI: {
    applyGraphDeltaToDBThroughMem: mockApplyGraphDeltaToDB,
    getGraph: mockGetGraph,
    loadSettings: mockLoadSettings,
    saveSettings: mockSaveSettings,
  },
}))

describe('setupRPCHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should register IPC handler for rpc:call channel', async () => {
    const { setupRPCHandlers } = await import('./rpc-handler.ts')

    setupRPCHandlers()

    expect(mockIpcMainHandle).toHaveBeenCalledWith('rpc:call', expect.any(Function))
  })

  it('should call correct function from mainAPI when valid function name provided', async () => {
    const { setupRPCHandlers } = await import('./rpc-handler.ts')

    mockGetGraph.mockReturnValue({ nodes: [], edges: [] })

    setupRPCHandlers()

    // Get the registered handler
    const handlerCall = mockIpcMainHandle.mock.calls.find(call => call[0] === 'rpc:call')
    expect(handlerCall).toBeDefined()
    const handler = handlerCall?.[1]

    // Call handler with 'getGraph' function name
    const result = await handler({}, 'getGraph', [])

    expect(mockGetGraph).toHaveBeenCalled()
    expect(result).toEqual({ nodes: [], edges: [] })
  })

  it('should pass arguments correctly to the called function', async () => {
    const { setupRPCHandlers } = await import('./rpc-handler.ts')

    const mockSettings = { agentLaunchPath: '/test/path', agentCommand: './test.sh' }
    mockSaveSettings.mockResolvedValue(undefined)

    setupRPCHandlers()

    const handlerCall = mockIpcMainHandle.mock.calls.find(call => call[0] === 'rpc:call')
    const handler = handlerCall?.[1]

    // Call handler with 'saveSettings' and arguments
    await handler({}, 'saveSettings', [mockSettings])

    expect(mockSaveSettings).toHaveBeenCalledWith(mockSettings)
  })

  it('should return error when function does not exist in mainAPI', async () => {
    const { setupRPCHandlers } = await import('./rpc-handler.ts')

    setupRPCHandlers()

    const handlerCall = mockIpcMainHandle.mock.calls.find(call => call[0] === 'rpc:call')
    const handler = handlerCall?.[1]

    // Call handler with non-existent function name
    const result = await handler({}, 'nonExistentFunction', [])

    expect(result).toEqual({ error: 'Function not found: nonExistentFunction' })
  })

  it('should handle function errors gracefully', async () => {
    const { setupRPCHandlers } = await import('./rpc-handler.ts')

    const testError = new Error('Test error')
    // Use rejected promise instead of throwing for functional style
    mockGetGraph.mockRejectedValue(testError)

    setupRPCHandlers()

    const handlerCall = mockIpcMainHandle.mock.calls.find(call => call[0] === 'rpc:call')
    const handler = handlerCall?.[1]

    // Call handler with function that returns rejected promise
    const result = await handler({}, 'getGraph', [])

    expect(result).toEqual({ error: 'RPC call failed: Test error' })
  })

  it('should handle Promise rejections', async () => {
    const { setupRPCHandlers } = await import('./rpc-handler.ts')

    const testError = new Error('Async error')
    mockLoadSettings.mockRejectedValue(testError)

    setupRPCHandlers()

    const handlerCall = mockIpcMainHandle.mock.calls.find(call => call[0] === 'rpc:call')
    const handler = handlerCall?.[1]

    // Call handler with function that returns rejected promise
    const result = await handler({}, 'loadSettings', [])

    expect(result).toEqual({ error: 'RPC call failed: Async error' })
  })

  it('should handle non-Error rejected values', async () => {
    const { setupRPCHandlers } = await import('./rpc-handler.ts')

    // Use rejected promise with non-Error value instead of throwing
    mockGetGraph.mockRejectedValue('String error')

    setupRPCHandlers()

    const handlerCall = mockIpcMainHandle.mock.calls.find(call => call[0] === 'rpc:call')
    const handler = handlerCall?.[1]

    // Call handler with function that rejects with non-Error
    const result = await handler({}, 'getGraph', [])

    expect(result).toEqual({ error: 'RPC call failed: String error' })
  })

  it('should preserve return value types from called functions', async () => {
    const { setupRPCHandlers } = await import('./rpc-handler.ts')

    const mockGraphData = { nodes: [{ id: '1', label: 'test' }], edges: [] }
    mockGetGraph.mockReturnValue(mockGraphData)

    setupRPCHandlers()

    const handlerCall = mockIpcMainHandle.mock.calls.find(call => call[0] === 'rpc:call')
    const handler = handlerCall?.[1]

    const result = await handler({}, 'getGraph', [])

    expect(result).toBe(mockGraphData) // Exact object reference preserved
  })
})

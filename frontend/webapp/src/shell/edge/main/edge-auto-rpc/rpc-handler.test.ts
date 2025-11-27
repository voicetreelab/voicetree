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
const mockApplyGraphDeltaToDB: Mock<(...args: any[]) => any> = vi.fn()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetGraph: Mock<(...args: any[]) => any> = vi.fn()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockLoadSettings: Mock<(...args: any[]) => any> = vi.fn()
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockSaveSettings: Mock<(...args: any[]) => any> = vi.fn()

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
    const { setupRPCHandlers } = await import('./rpc-handler')

    setupRPCHandlers()

    expect(mockIpcMainHandle).toHaveBeenCalledWith('rpc:call', expect.any(Function))
  })

  it('should call correct function from mainAPI when valid function name provided', async () => {
    const { setupRPCHandlers } = await import('./rpc-handler')

    mockGetGraph.mockReturnValue({ nodes: [], edges: [] })

    setupRPCHandlers()

    // Get the registered handler
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlerCall: any[] | undefined = mockIpcMainHandle.mock.calls.find(call => call[0] === 'rpc:call') as any[] | undefined;
    expect(handlerCall).toBeDefined()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler: any = handlerCall?.[1];

    // Call handler with 'getGraph' function name
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await handler({}, 'getGraph', []);

    expect(mockGetGraph).toHaveBeenCalled()
    expect(result).toEqual({ nodes: [], edges: [] })
  })

  it('should pass arguments correctly to the called function', async () => {
    const { setupRPCHandlers } = await import('./rpc-handler')

    const mockSettings: { agentLaunchPath: string; agentCommand: string; } = { agentLaunchPath: '/test/path', agentCommand: './test.sh' }
    mockSaveSettings.mockResolvedValue(undefined)

    setupRPCHandlers()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlerCall: any[] | undefined = mockIpcMainHandle.mock.calls.find(call => call[0] === 'rpc:call') as any[] | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler: any = handlerCall?.[1];

    // Call handler with 'saveSettings' and arguments
    await handler({}, 'saveSettings', [mockSettings])

    expect(mockSaveSettings).toHaveBeenCalledWith(mockSettings)
  })

  it('should return error when function does not exist in mainAPI', async () => {
    const { setupRPCHandlers } = await import('./rpc-handler')

    setupRPCHandlers()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlerCall: any[] | undefined = mockIpcMainHandle.mock.calls.find(call => call[0] === 'rpc:call') as any[] | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler: any = handlerCall?.[1];

    // Call handler with non-existent function name
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await handler({}, 'nonExistentFunction', []);

    expect(result).toEqual({ error: 'Function not found: nonExistentFunction' })
  })

  it('should handle promise rejections with Error and non-Error values', async () => {
    const { setupRPCHandlers } = await import('./rpc-handler')

    setupRPCHandlers()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlerCall: any[] | undefined = mockIpcMainHandle.mock.calls.find(call => call[0] === 'rpc:call') as any[] | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler: any = handlerCall?.[1];

    // Test promise rejection with Error object
    const testError: Error = new Error('Test error')
    mockGetGraph.mockRejectedValue(testError)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const errorResult: any = await handler({}, 'getGraph', []);
    expect(errorResult).toEqual({ error: 'RPC call failed: Test error' })

    // Test promise rejection with non-Error value
    mockGetGraph.mockRejectedValue('String error')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nonErrorResult: any = await handler({}, 'getGraph', []);
    expect(nonErrorResult).toEqual({ error: 'RPC call failed: String error' })
  })

  it('should preserve return value types from called functions', async () => {
    const { setupRPCHandlers } = await import('./rpc-handler')

    const mockGraphData: { nodes: { id: string; label: string; }[]; edges: never[]; } = { nodes: [{ id: '1', label: 'test' }], edges: [] }
    mockGetGraph.mockReturnValue(mockGraphData)

    setupRPCHandlers()

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handlerCall: any[] | undefined = mockIpcMainHandle.mock.calls.find(call => call[0] === 'rpc:call') as any[] | undefined;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler: any = handlerCall?.[1];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result: any = await handler({}, 'getGraph', []);

    expect(result).toBe(mockGraphData) // Exact object reference preserved
  })
})

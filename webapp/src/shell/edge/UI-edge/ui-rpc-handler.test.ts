/**
 * Unit tests for ui-rpc-handler.ts
 * Tests the UI RPC handler that receives IPC calls from main process
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { Mock, MockInstance } from 'vitest'

// Store the registered callback so we can invoke it in tests
let registeredCallback: ((_event: unknown, funcName: unknown, args: unknown) => void) | null = null

// Mock electronAPI
const mockOn: Mock = vi.fn((channel: string, callback: (_event: unknown, funcName: unknown, args: unknown) => void) => {
    if (channel === 'ui:call') {
        registeredCallback = callback
    }
})

// Mock uiAPIHandler functions
const mockSetIsTrackpadScrolling: Mock = vi.fn()
const mockLaunchTerminalOntoUI: Mock = vi.fn()

vi.mock('@/shell/edge/UI-edge/api', () => ({
    uiAPIHandler: {
        setIsTrackpadScrolling: mockSetIsTrackpadScrolling,
        launchTerminalOntoUI: mockLaunchTerminalOntoUI,
    },
}))

describe('setupUIRpcHandler', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        registeredCallback = null

        // Setup window.electronAPI mock
        vi.stubGlobal('window', {
            electronAPI: {
                on: mockOn,
            },
        })
    })

    afterEach(() => {
        vi.unstubAllGlobals()
    })

    it('should register listener for ui:call channel', async () => {
        const { setupUIRpcHandler } = await import('./ui-rpc-handler')

        setupUIRpcHandler()

        expect(mockOn).toHaveBeenCalledWith('ui:call', expect.any(Function))
    })

    it('should dispatch to correct uiAPIHandler function when ui:call is received', async () => {
        const { setupUIRpcHandler } = await import('./ui-rpc-handler')

        setupUIRpcHandler()

        // Simulate receiving an IPC message
        expect(registeredCallback).not.toBeNull()
        registeredCallback!({}, 'setIsTrackpadScrolling', [true])

        expect(mockSetIsTrackpadScrolling).toHaveBeenCalledWith(true)
    })

    it('should handle multiple arguments correctly', async () => {
        const { setupUIRpcHandler } = await import('./ui-rpc-handler')

        setupUIRpcHandler()

        registeredCallback!({}, 'launchTerminalOntoUI', ['node-123', { id: 'term-1' }, false])

        expect(mockLaunchTerminalOntoUI).toHaveBeenCalledWith('node-123', { id: 'term-1' }, false)
    })

    it('should log error for unknown function names', async () => {
        const { setupUIRpcHandler } = await import('./ui-rpc-handler')
        const consoleSpy: MockInstance = vi.spyOn(console, 'error').mockImplementation(() => {})

        setupUIRpcHandler()

        registeredCallback!({}, 'nonExistentFunction', [])

        expect(consoleSpy).toHaveBeenCalledWith('[UI RPC] Unknown UI function: nonExistentFunction')
        consoleSpy.mockRestore()
    })

    it('should skip setup when electronAPI.on is not available', async () => {
        vi.stubGlobal('window', {
            electronAPI: undefined,
        })

        const { setupUIRpcHandler } = await import('./ui-rpc-handler')
        const consoleSpy: MockInstance = vi.spyOn(console, 'warn').mockImplementation(() => {})

        setupUIRpcHandler()

        expect(consoleSpy).toHaveBeenCalledWith('[UI RPC] electronAPI.on not available, skipping UI RPC handler setup')
        expect(mockOn).not.toHaveBeenCalled()
        consoleSpy.mockRestore()
    })

    it('should receive event as first argument (verifying IPC signature)', async () => {
        const { setupUIRpcHandler } = await import('./ui-rpc-handler')

        setupUIRpcHandler()

        // The callback signature is (_event, funcName, args)
        // Simulate what ipcRenderer.on passes: (event, arg1, arg2)
        const mockEvent: object = { sender: 'mock-sender' }
        registeredCallback!(mockEvent, 'setIsTrackpadScrolling', [false])

        // Function should still be called correctly despite event being passed
        expect(mockSetIsTrackpadScrolling).toHaveBeenCalledWith(false)
    })

    it('TIMING TEST: messages sent before setupUIRpcHandler are lost', async () => {
        // This test documents the expected behavior when IPC arrives before handler setup
        // If ui:call messages are sent before setupUIRpcHandler() runs, they are lost
        // because ipcRenderer.on() only receives messages sent AFTER the listener is registered

        const { setupUIRpcHandler } = await import('./ui-rpc-handler')

        // Simulate IPC message arriving BEFORE handler is set up
        // registeredCallback is null at this point
        expect(registeredCallback).toBeNull()

        // Any IPC message sent now would be lost (no listener registered)
        // This is the expected Electron behavior - listeners only receive future messages

        // Now set up the handler
        setupUIRpcHandler()
        expect(registeredCallback).not.toBeNull()

        // Messages sent AFTER setup work fine
        registeredCallback!({}, 'setIsTrackpadScrolling', [true])
        expect(mockSetIsTrackpadScrolling).toHaveBeenCalledWith(true)
    })
})

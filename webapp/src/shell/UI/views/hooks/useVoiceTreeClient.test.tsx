import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import useVoiceTreeClient from './useVoiceTreeClient'
import type { ErrorStatus } from '@soniox/speech-to-text-web'

// Mock the forceRefreshAPIKey function
vi.mock('../../../../utils/get-api-key', () => ({
  forceRefreshAPIKey: vi.fn().mockResolvedValue('fresh-api-key'),
}))

// Track callbacks registered with SonioxClient
type MockCallbacks = {
  onError?: (status: ErrorStatus, message: string, errorCode: number | undefined) => void
  onStarted?: () => void
  onFinished?: () => void
  onStateChange?: (update: { oldState: string; newState: string }) => void
  onPartialResult?: (result: { tokens: [] }) => void
}

let mockCallbacks: MockCallbacks = {}
let mockStartCount = 0
let mockCancelCount = 0
let mockShouldFailStart = false // When true, start won't call onStarted (simulates failure)

// Mock the SonioxClient class
vi.mock('@soniox/speech-to-text-web', () => ({
  SonioxClient: vi.fn().mockImplementation(() => ({
    start: vi.fn().mockImplementation(async (options) => {
      mockStartCount++
      mockCallbacks = {
        onError: options.onError,
        onStarted: options.onStarted,
        onFinished: options.onFinished,
        onStateChange: options.onStateChange,
        onPartialResult: options.onPartialResult,
      }
      // Simulate successful start (unless configured to fail)
      if (!mockShouldFailStart) {
        mockCallbacks.onStarted?.()
        mockCallbacks.onStateChange?.({ oldState: 'Init', newState: 'Running' })
      }
    }),
    stop: vi.fn(),
    cancel: vi.fn().mockImplementation(() => {
      mockCancelCount++
    }),
  })),
}))

describe('useVoiceTreeClient', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockCallbacks = {}
    mockStartCount = 0
    mockCancelCount = 0
    mockShouldFailStart = false
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.clearAllMocks()
  })

  describe('reactive reconnection - auto-reconnect on ANY error', () => {
    it('auto-reconnects once on api_error (Invalid/expired temporary API key)', async () => {
      const { result } = renderHook(() =>
        useVoiceTreeClient({
          apiKey: 'test-api-key',
        })
      )

      // Start transcription
      await act(async () => {
        await result.current.startTranscription()
      })

      expect(mockStartCount).toBe(1)

      // Simulate the "Invalid/expired temporary API key" error
      act(() => {
        mockCallbacks.onError?.('api_error', 'Invalid/expired temporary API key.', 401)
      })

      // Wait for the reactive reconnection delay (1 second) + flush promises for forceRefreshAPIKey
      await act(async () => {
        vi.advanceTimersByTime(1000)
        await Promise.resolve() // Flush forceRefreshAPIKey promise
      })

      // Should have attempted ONE reconnection
      expect(mockStartCount).toBe(2)
      // Error should NOT be set yet (we're retrying)
      expect(result.current.error).toBeNull()
    })

    it('auto-reconnects once on websocket_error', async () => {
      const { result } = renderHook(() =>
        useVoiceTreeClient({
          apiKey: 'test-api-key',
        })
      )

      await act(async () => {
        await result.current.startTranscription()
      })

      expect(mockStartCount).toBe(1)

      act(() => {
        mockCallbacks.onError?.('websocket_error', 'WebSocket connection failed', undefined)
      })

      await act(async () => {
        vi.advanceTimersByTime(1000)
        await Promise.resolve() // Flush forceRefreshAPIKey promise
      })

      // Should have attempted ONE reconnection
      expect(mockStartCount).toBe(2)
    })

    it('auto-reconnects once on api_key_fetch_failed', async () => {
      const { result } = renderHook(() =>
        useVoiceTreeClient({
          apiKey: async () => 'fetched-key',
        })
      )

      await act(async () => {
        await result.current.startTranscription()
      })

      expect(mockStartCount).toBe(1)

      act(() => {
        mockCallbacks.onError?.('api_key_fetch_failed', 'Failed to fetch API key', undefined)
      })

      await act(async () => {
        vi.advanceTimersByTime(1000)
        await Promise.resolve() // Flush forceRefreshAPIKey promise
      })

      expect(mockStartCount).toBe(2)
    })

    it('stops retrying after max attempts and shows error', async () => {
      const { result } = renderHook(() =>
        useVoiceTreeClient({
          apiKey: 'test-api-key',
        })
      )

      await act(async () => {
        await result.current.startTranscription()
      })

      expect(mockStartCount).toBe(1)

      // Make subsequent starts "fail" (don't call onStarted, so counter won't reset)
      mockShouldFailStart = true

      // First error - triggers reconnection attempt
      act(() => {
        mockCallbacks.onError?.('api_error', 'Invalid/expired temporary API key.', 401)
      })

      await act(async () => {
        vi.advanceTimersByTime(1000)
        await Promise.resolve() // Flush forceRefreshAPIKey promise
      })

      // Reconnection was attempted (but failed - no onStarted called)
      expect(mockStartCount).toBe(2)

      // Second error - max attempts already reached, should show error immediately
      act(() => {
        mockCallbacks.onError?.('api_error', 'Invalid/expired temporary API key.', 401)
      })

      await act(async () => {
        vi.advanceTimersByTime(1000)
        await Promise.resolve()
      })

      // Should NOT have attempted another reconnection
      expect(mockStartCount).toBe(2)

      // Error should be set now
      expect(result.current.error).toEqual({
        status: 'api_error',
        message: 'Invalid/expired temporary API key.',
        errorCode: 401,
      })
    })

    it('resets retry counter after successful reconnection', async () => {
      const { result } = renderHook(() =>
        useVoiceTreeClient({
          apiKey: 'test-api-key',
        })
      )

      await act(async () => {
        await result.current.startTranscription()
      })

      expect(mockStartCount).toBe(1)

      // First error - triggers reconnection
      act(() => {
        mockCallbacks.onError?.('api_error', 'Error 1', 401)
      })

      await act(async () => {
        vi.advanceTimersByTime(1000)
        await Promise.resolve() // Flush forceRefreshAPIKey promise
      })

      // Reconnection succeeded (onStarted was called), counter should be reset
      expect(mockStartCount).toBe(2)

      // Another error - should trigger reconnection again (counter was reset)
      act(() => {
        mockCallbacks.onError?.('websocket_error', 'Error 2', undefined)
      })

      await act(async () => {
        vi.advanceTimersByTime(1000)
        await Promise.resolve() // Flush forceRefreshAPIKey promise
      })

      // Should have attempted another reconnection
      expect(mockStartCount).toBe(3)
    })

    it('does not attempt reconnection if user stopped recording', async () => {
      const { result } = renderHook(() =>
        useVoiceTreeClient({
          apiKey: 'test-api-key',
        })
      )

      await act(async () => {
        await result.current.startTranscription()
      })

      expect(mockStartCount).toBe(1)

      // Stop recording
      act(() => {
        result.current.stopTranscription()
      })

      // Error occurs after stopping
      act(() => {
        mockCallbacks.onError?.('api_error', 'Error after stop', 401)
      })

      await act(async () => {
        vi.advanceTimersByTime(2000)
      })

      // Should NOT have attempted reconnection
      expect(mockStartCount).toBe(1)
    })
  })

  describe('proactive restart', () => {
    it('starts transcription successfully', async () => {
      const onStarted = vi.fn()
      const { result } = renderHook(() =>
        useVoiceTreeClient({
          apiKey: 'test-api-key',
          onStarted,
        })
      )

      await act(async () => {
        await result.current.startTranscription()
      })

      expect(mockStartCount).toBe(1)
      expect(onStarted).toHaveBeenCalled()
    })

    it('stops transcription and clears proactive restart timer', async () => {
      const { result } = renderHook(() =>
        useVoiceTreeClient({
          apiKey: 'test-api-key',
        })
      )

      await act(async () => {
        await result.current.startTranscription()
      })

      act(() => {
        result.current.stopTranscription()
      })

      // Advance time past the proactive restart interval
      await act(async () => {
        vi.advanceTimersByTime(20 * 60 * 1000) // 20 minutes
      })

      // Should NOT have restarted after stopping
      expect(mockStartCount).toBe(1)
    })

    it('schedules proactive restart after 18 minutes', async () => {
      const { result } = renderHook(() =>
        useVoiceTreeClient({
          apiKey: 'test-api-key',
        })
      )

      await act(async () => {
        await result.current.startTranscription()
      })

      expect(mockStartCount).toBe(1)

      // Advance time to just before proactive restart (17 minutes)
      await act(async () => {
        vi.advanceTimersByTime(17 * 60 * 1000)
      })

      expect(mockStartCount).toBe(1) // Not yet restarted

      // Advance past 18 minute mark
      await act(async () => {
        vi.advanceTimersByTime(2 * 60 * 1000) // +2 more minutes = 19 total
        await Promise.resolve() // Flush forceRefreshAPIKey promise
      })

      // Should have proactively restarted
      expect(mockStartCount).toBe(2)
    })
  })

  describe('cancelTranscription - force abort', () => {
    it('exposes cancelTranscription that calls cancel on the client', async () => {
      const { result } = renderHook(() =>
        useVoiceTreeClient({
          apiKey: 'test-api-key',
        })
      )

      await act(async () => {
        await result.current.startTranscription()
      })

      const cancelCountBefore: number = mockCancelCount

      act(() => {
        result.current.cancelTranscription()
      })

      // cancel() should have been called (once for the internal cancel in startTranscriptionInternal + once for cancelTranscription)
      expect(mockCancelCount).toBeGreaterThan(cancelCountBefore)
    })
  })

  describe('stop timeout safety net', () => {
    it('force cancels if stop does not complete within timeout', async () => {
      const { result } = renderHook(() =>
        useVoiceTreeClient({
          apiKey: 'test-api-key',
        })
      )

      await act(async () => {
        await result.current.startTranscription()
      })

      const cancelCountBefore: number = mockCancelCount

      // Stop transcription (this starts the timeout)
      act(() => {
        result.current.stopTranscription()
      })

      // Advance time past the 5-second stop timeout
      await act(async () => {
        vi.advanceTimersByTime(5000)
      })

      // cancel() should have been called as safety net
      expect(mockCancelCount).toBeGreaterThan(cancelCountBefore)
    })

    it('does not force cancel if state reaches terminal before timeout', async () => {
      const { result } = renderHook(() =>
        useVoiceTreeClient({
          apiKey: 'test-api-key',
        })
      )

      await act(async () => {
        await result.current.startTranscription()
      })

      const cancelCountBefore: number = mockCancelCount

      // Stop transcription
      act(() => {
        result.current.stopTranscription()
      })

      // Simulate the SDK reaching Finished state before timeout
      act(() => {
        mockCallbacks.onStateChange?.({ oldState: 'Stopping', newState: 'Finished' })
      })

      // Advance time past the timeout
      await act(async () => {
        vi.advanceTimersByTime(6000)
      })

      // cancel() should NOT have been called (timeout was cleared by terminal state)
      expect(mockCancelCount).toBe(cancelCountBefore)
    })
  })
})

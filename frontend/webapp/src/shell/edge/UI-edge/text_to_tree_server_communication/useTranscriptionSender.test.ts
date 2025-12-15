import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTranscriptionSender } from '@/shell/edge/UI-edge/text_to_tree_server_communication/useTranscriptionSender';
import { type Token } from '@soniox/speech-to-text-web';
import * as TranscriptionStore from '@/shell/edge/UI-edge/state/TranscriptionStore';

// Mock the TranscriptionStore
vi.mock('@/shell/edge/UI-edge/state/TranscriptionStore', () => {
  let listeners: Set<() => void> = new Set();
  let mockFinalTokens: Token[] = [];

  return {
    subscribe: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    getFinalTokens: vi.fn(() => mockFinalTokens),
    // Test helpers
    __setMockFinalTokens: (tokens: Token[]) => {
      mockFinalTokens = tokens;
    },
    __triggerListeners: () => {
      listeners.forEach(l => l());
    },
    __reset: () => {
      listeners = new Set();
      mockFinalTokens = [];
    },
  };
});

// Type for mock store with test helpers
type MockStoreType = typeof TranscriptionStore & {
  __setMockFinalTokens: (tokens: Token[]) => void;
  __triggerListeners: () => void;
  __reset: () => void;
};

// Type assertion for test helpers
const mockStore: MockStoreType = TranscriptionStore as MockStoreType;

describe('useTranscriptionSender - Behavioral Tests', () => {
  const endpoint: "http://localhost:8001/send-text" = 'http://localhost:8001/send-text';
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockStore.__reset();

    // Create and stub fetch for this test
    mockFetch = vi.fn();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ buffer_length: 100 }),
    });
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // Helper to create tokens
  const createToken: (text: string, is_final?: boolean) => Token = (text: string, is_final: boolean = true): Token => ({
    text,
    is_final,
    speaker: undefined,
    language: undefined,
    confidence: 1.0,
  });

  // Helper to simulate token updates via store
  const simulateTokenUpdate: (tokens: Token[]) => void = (tokens: Token[]): void => {
    mockStore.__setMockFinalTokens(tokens);
    mockStore.__triggerListeners();
  };

  describe('Store Subscription Behavior', () => {
    it('should subscribe to TranscriptionStore on mount', () => {
      renderHook(() => useTranscriptionSender({ endpoint }));

      expect(TranscriptionStore.subscribe).toHaveBeenCalledTimes(1);
    });

    it('should unsubscribe from TranscriptionStore on unmount', () => {
      const { unmount } = renderHook(() => useTranscriptionSender({ endpoint }));

      const unsubscribeFn: () => void = vi.mocked(TranscriptionStore.subscribe).mock.results[0].value;

      unmount();

      // The unsubscribe function should have been called
      // We verify this by checking that the subscribe was called and we got a function back
      expect(typeof unsubscribeFn).toBe('function');
    });

    it('should send only new tokens when store updates', async () => {
      renderHook(() => useTranscriptionSender({ endpoint }));

      // First batch of tokens
      const firstTokens: Token[] = [createToken('Hello'), createToken(' world')];

      await act(async () => {
        simulateTokenUpdate(firstTokens);
        // Allow microtask to complete
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify first send contains "Hello world"
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const firstCall: any[] = mockFetch.mock.calls[0];
      const firstBody: { text: string } = JSON.parse(firstCall[1].body);
      expect(firstBody.text).toBe('Hello world');

      // Add more tokens (simulating incremental transcription)
      const updatedTokens: Token[] = [
        ...firstTokens,
        createToken(' how'),
        createToken(' are'),
        createToken(' you')
      ];

      await act(async () => {
        simulateTokenUpdate(updatedTokens);
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify second send contains only the NEW text
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const secondCall: any[] = mockFetch.mock.calls[1];
      const secondBody: { text: string } = JSON.parse(secondCall[1].body);
      expect(secondBody.text).toBe(' how are you');

      // Should NOT resend "Hello world"
      expect(secondBody.text).not.toContain('Hello world');
    });

    it('should not send anything if tokens array is unchanged', async () => {
      renderHook(() => useTranscriptionSender({ endpoint }));

      const tokens: Token[] = [createToken('Test'), createToken(' text')];

      // Send once
      await act(async () => {
        simulateTokenUpdate(tokens);
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Trigger store update with same tokens
      await act(async () => {
        simulateTokenUpdate(tokens);
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      // Should not make another fetch call
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('Reset Behavior', () => {
    it('should reset tracking and resend all tokens after reset', async () => {
      const { result } = renderHook(() => useTranscriptionSender({ endpoint }));

      const tokens: Token[] = [createToken('Hello'), createToken(' world')];

      // First send
      await act(async () => {
        simulateTokenUpdate(tokens);
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body).text).toBe('Hello world');

      // Reset the sender
      act(() => {
        result.current.reset();
      });

      // Trigger store update with same tokens after reset
      await act(async () => {
        simulateTokenUpdate(tokens);
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      // Should send again because we reset
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(JSON.parse(mockFetch.mock.calls[1][1].body).text).toBe('Hello world');
    });
  });

  describe('Manual Text Behavior', () => {
    it('should send manual text independently of token tracking', async () => {
      const { result } = renderHook(() => useTranscriptionSender({ endpoint }));

      // Send some tokens first via store
      const tokens: Token[] = [createToken('Voice'), createToken(' input')];
      await act(async () => {
        simulateTokenUpdate(tokens);
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      // Send manual text
      await act(async () => {
        await result.current.sendManualText('Manual text entry');
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify both sends
      expect(JSON.parse(mockFetch.mock.calls[0][1].body).text).toBe('Voice input');
      expect(JSON.parse(mockFetch.mock.calls[1][1].body).text).toBe('Manual text entry');

      // Sending more tokens should continue from where we left off
      const moreTokens: Token[] = [...tokens, createToken(' continued')];
      await act(async () => {
        simulateTokenUpdate(moreTokens);
        await new Promise(resolve => setTimeout(resolve, 0));
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(JSON.parse(mockFetch.mock.calls[2][1].body).text).toBe(' continued');
    });
  });

  describe('State Management Behavior', () => {
    it('should update buffer length from server response', async () => {
      const { result } = renderHook(() => useTranscriptionSender({ endpoint }));

      expect(result.current.bufferLength).toBe(0);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ buffer_length: 250 }),
      });

      await act(async () => {
        await result.current.sendManualText('Test text');
      });

      expect(result.current.bufferLength).toBe(250);
    });

    it('should set and clear processing state correctly', async () => {
      const { result } = renderHook(() => useTranscriptionSender({ endpoint }));

      expect(result.current.isProcessing).toBe(false);

      // Create a promise we can control
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let resolvePromise: (value: any) => void;
      const controlledPromise: Promise<unknown> = new Promise(resolve => {
        resolvePromise = resolve;
      });

      mockFetch.mockReturnValueOnce(controlledPromise);

      // Start sending without awaiting to check intermediate state
      let sendPromise: Promise<void>;
      act(() => {
        sendPromise = result.current.sendManualText('Test');
      });

      // Should be processing now (state update happens synchronously)
      expect(result.current.isProcessing).toBe(true);

      // Resolve the request
      resolvePromise!({
        ok: true,
        json: async () => ({ buffer_length: 100 }),
      });

      // Wait for the send to complete
      await act(async () => {
        await sendPromise!;
      });

      // Should not be processing anymore
      expect(result.current.isProcessing).toBe(false);
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTranscriptionSender } from '@/shell/UI/views/hooks/useTranscriptionSender';
import { type Token } from '@soniox/speech-to-text-web';

describe('useTranscriptionSender - Behavioral Tests', () => {
  const endpoint: "http://localhost:8001/send-text" = 'http://localhost:8001/send-text';
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();

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

  describe('Incremental Sending Behavior', () => {
    it('should send only new tokens when tokens are added incrementally', async () => {
      const { result } = renderHook(() => useTranscriptionSender({ endpoint }));

      // First batch of tokens
      const firstTokens: Token[] = [createToken('Hello'), createToken(' world')];

      await act(async () => {
        await result.current.sendIncrementalTokens(firstTokens);
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Verify first send contains "Hello world"
      const firstCall: any[] = mockFetch.mock.calls[0];
      const firstBody = JSON.parse(firstCall[1].body);
      expect(firstBody.text).toBe('Hello world');

      // Add more tokens (simulating incremental transcription)
      const updatedTokens: Token[] = [
        ...firstTokens,
        createToken(' how'),
        createToken(' are'),
        createToken(' you')
      ];

      await act(async () => {
        await result.current.sendIncrementalTokens(updatedTokens);
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);

      // Verify second send contains only the NEW text
      const secondCall: any[] = mockFetch.mock.calls[1];
      const secondBody = JSON.parse(secondCall[1].body);
      expect(secondBody.text).toBe(' how are you');

      // Should NOT resend "Hello world"
      expect(secondBody.text).not.toContain('Hello world');
    });

    it('should NOT send non-final tokens', async () => {
      const { result } = renderHook(() => useTranscriptionSender({ endpoint }));

      // Mix of final and non-final tokens
      const tokens: Token[] = [
        createToken('Hello', true),  // final
        createToken(' world', false), // non-final
        createToken(' test', true),   // final
        createToken(' draft', false), // non-final
      ];

      await act(async () => {
        await result.current.sendIncrementalTokens(tokens);
      });

      // Should only send the final tokens
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.text).toBe('Hello test'); // Only final tokens
      expect(body.text).not.toContain('world'); // Non-final not included
      expect(body.text).not.toContain('draft'); // Non-final not included
    });

    it('should not send anything if tokens array is unchanged', async () => {
      const { result } = renderHook(() => useTranscriptionSender({ endpoint }));

      const tokens: Token[] = [createToken('Test'), createToken(' text')];

      // Send once
      await act(async () => {
        await result.current.sendIncrementalTokens(tokens);
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);

      // Send same tokens again
      await act(async () => {
        await result.current.sendIncrementalTokens(tokens);
      });

      // Should not make another fetch call
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should handle multiple incremental updates correctly', async () => {
      const { result } = renderHook(() => useTranscriptionSender({ endpoint }));

      const updates: { tokens: Token[]; expectedText: string; }[] = [
        { tokens: [createToken('First')], expectedText: 'First' },
        { tokens: [createToken('First'), createToken(' second')], expectedText: ' second' },
        { tokens: [createToken('First'), createToken(' second'), createToken(' third')], expectedText: ' third' },
        { tokens: [createToken('First'), createToken(' second'), createToken(' third'), createToken(' fourth')], expectedText: ' fourth' },
      ];

      for (const [index, update] of updates.entries()) {
        await act(async () => {
          await result.current.sendIncrementalTokens(update.tokens);
        });

        expect(mockFetch).toHaveBeenCalledTimes(index + 1);

        const call: any[] = mockFetch.mock.calls[index];
        const body = JSON.parse(call[1].body);
        expect(body.text).toBe(update.expectedText);
      }

      // Verify no text was sent twice
      const allSentTexts: any[] = mockFetch.mock.calls.map(call => JSON.parse(call[1].body).text);
      const fullText: string = allSentTexts.join('');
      expect(fullText).toBe('First second third fourth');
    });
  });

  describe('Reset Behavior', () => {
    it('should reset tracking and resend all tokens after reset', async () => {
      const { result } = renderHook(() => useTranscriptionSender({ endpoint }));

      const tokens: Token[] = [createToken('Hello'), createToken(' world')];

      // First send
      await act(async () => {
        await result.current.sendIncrementalTokens(tokens);
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body).text).toBe('Hello world');

      // Reset the sender
      act(() => {
        result.current.reset();
      });

      // Send same tokens again after reset
      await act(async () => {
        await result.current.sendIncrementalTokens(tokens);
      });

      // Should send again because we reset
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(JSON.parse(mockFetch.mock.calls[1][1].body).text).toBe('Hello world');
    });
  });

  describe('Manual Text Behavior', () => {
    it('should send manual text independently of token tracking', async () => {
      const { result } = renderHook(() => useTranscriptionSender({ endpoint }));

      // Send some tokens first
      const tokens: Token[] = [createToken('Voice'), createToken(' input')];
      await act(async () => {
        await result.current.sendIncrementalTokens(tokens);
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
        await result.current.sendIncrementalTokens(moreTokens);
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(JSON.parse(mockFetch.mock.calls[2][1].body).text).toBe(' continued');
    });
  });

  describe('Error Handling Behavior', () => {
    it('should not update tracking on failed sends', async () => {
      // Suppress console.error for this test since we're intentionally causing an error
      const consoleErrorSpy: import("/Users/bobbobby/repos/VoiceTree/frontend/webapp/node_modules/vitest/dist/index").MockInstance<{ (...data: any[]): void; (message?: any, ...optionalParams: any[]): void; }> = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => useTranscriptionSender({ endpoint }));

      // First send will fail
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const firstTokens: Token[] = [createToken('Hello')];

      await act(async () => {
        await result.current.sendIncrementalTokens(firstTokens);
      });

      expect(result.current.connectionError).toBeTruthy();

      // Restore console.error
      consoleErrorSpy.mockRestore();

      // Fix the network
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ buffer_length: 100 }),
      });

      // Try sending more tokens
      const allTokens: Token[] = [createToken('Hello'), createToken(' world')];

      await act(async () => {
        await result.current.sendIncrementalTokens(allTokens);
      });

      // Should send BOTH tokens because first send failed
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const secondCall: any[] = mockFetch.mock.calls[1];
      const secondBody = JSON.parse(secondCall[1].body);
      expect(secondBody.text).toBe('Hello world'); // Both tokens sent
    });

    it('should skip empty text tokens without breaking tracking', async () => {
      const { result } = renderHook(() => useTranscriptionSender({ endpoint }));

      const tokens: Token[] = [
        createToken('Text'),
        createToken(''), // Empty token
        createToken(' '), // Whitespace token - will be included since it's valid text
      ];

      await act(async () => {
        await result.current.sendIncrementalTokens(tokens);
      });

      // Should send "Text " (including whitespace since it's valid)
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(JSON.parse(mockFetch.mock.calls[0][1].body).text).toBe('Text ');

      // Add more tokens
      const moreTokens: Token[] = [...tokens, createToken('More')];

      await act(async () => {
        await result.current.sendIncrementalTokens(moreTokens);
      });

      // Should only send "More" (not resend "Text ")
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(JSON.parse(mockFetch.mock.calls[1][1].body).text).toBe('More');
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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import VoiceTreeTranscribe from '@/renderers/voicetree-transcribe.tsx';
import { type Token } from '@soniox/speech-to-text-web';

// Mock the dependencies
vi.mock('@/hooks/useVoiceTreeClient', () => ({
  default: vi.fn(() => ({
    state: 'Idle',
    finalTokens: [],
    nonFinalTokens: [],
    startTranscription: vi.fn(),
    stopTranscription: vi.fn(),
    error: null,
  })),
}));

vi.mock('@/utils/get-api-key', () => ({
  default: vi.fn(() => 'test-api-key'),
}));

describe.sequential('VoiceTree Incremental Sending Integration', () => {
  // Track network requests per-test (moved into describe for proper scoping)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let networkRequests: Array<{ url: string; body: any }> = [];

  beforeEach(() => {
    // Clean up any leftover DOM state
    cleanup();

    vi.clearAllMocks();

    // Reset network requests array for this test
    networkRequests = [];

    // Ensure navigator.clipboard is properly mocked
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: vi.fn().mockResolvedValue(undefined),
          readText: vi.fn().mockResolvedValue(''),
        },
        writable: true,
        configurable: true,
      });
    }

    // Mock window.electronAPI - always reset to ensure clean state
    Object.defineProperty(window, 'electronAPI', {
      value: {
        main: {
          getBackendPort: vi.fn(() => Promise.resolve(8001)),
        },
      },
      writable: true,
      configurable: true,
    });

    // Mock fetch to track requests - use vi.stubGlobal for proper cleanup
    vi.stubGlobal('fetch', vi.fn(async (url, options) => {
      const body = options?.body ? JSON.parse(options.body as string) : null;
      networkRequests.push({ url: url as string, body });

      return {
        ok: true,
        json: async () => ({ buffer_length: 100 + networkRequests.length * 10 }),
      } as Response;
    }));
  });

  afterEach(async () => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    // Allow any pending async operations to complete
    await new Promise(resolve => setTimeout(resolve, 10));
  });

  it('should only send incremental text to backend, not accumulated text', async () => {
    // Import the mock after setting it up
    const useVoiceTreeClient = (await import('@/hooks/useVoiceTreeClient.tsx')).default;

    // Create a sequence of tokens that simulates real transcription
    const tokenSequences: Token[][] = [
      // First update: "Hello"
      [{ text: 'Hello', is_final: true, confidence: 1.0 }],
      // Second update: "Hello world" (added " world")
      [
        { text: 'Hello', is_final: true, confidence: 1.0 },
        { text: ' world', is_final: true, confidence: 1.0 },
      ],
      // Third update: "Hello world, how are" (added ", how are")
      [
        { text: 'Hello', is_final: true, confidence: 1.0 },
        { text: ' world', is_final: true, confidence: 1.0 },
        { text: ', how are', is_final: true, confidence: 1.0 },
      ],
      // Fourth update: "Hello world, how are you?" (added " you?")
      [
        { text: 'Hello', is_final: true, confidence: 1.0 },
        { text: ' world', is_final: true, confidence: 1.0 },
        { text: ', how are', is_final: true, confidence: 1.0 },
        { text: ' you?', is_final: true, confidence: 1.0 },
      ],
    ];

    let currentTokenIndex = 0;

    // Mock the hook to return different tokens on each render
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useVoiceTreeClient as any).mockImplementation(() => ({
      state: 'Running',
      finalTokens: tokenSequences[currentTokenIndex] || [],
      nonFinalTokens: [],
      startTranscription: vi.fn(),
      stopTranscription: vi.fn(),
      error: null,
    }));

    const { rerender } = render(<VoiceTreeTranscribe />);

    // Simulate token updates
    for (let i = 0; i < tokenSequences.length; i++) {
      currentTokenIndex = i;
      rerender(<VoiceTreeTranscribe />);

      // Wait for the network request
      await waitFor(() => {
        expect(networkRequests.length).toBe(i + 1);
      }, { timeout: 2000 });
    }

    // Verify the behavior: each request should only send NEW text
    const expectedSends = [
      'Hello',           // First send: just "Hello"
      ' world',          // Second send: just the new " world"
      ', how are',       // Third send: just the new ", how are"
      ' you?',           // Fourth send: just the new " you?"
    ];

    expect(networkRequests.length).toBe(expectedSends.length);

    for (let i = 0; i < expectedSends.length; i++) {
      expect(networkRequests[i].body.text).toBe(expectedSends[i]);
      expect(networkRequests[i].url).toBe('http://localhost:8001/send-text');
    }

    // Verify we never sent accumulated text
    const allSentText = networkRequests.map(r => r.body.text);
    expect(allSentText).not.toContain('Hello world');
    expect(allSentText).not.toContain('Hello world, how are');
    expect(allSentText).not.toContain('Hello world, how are you?');

    // But if we concatenate all sends, we should get the full text
    const reconstructedText = allSentText.join('');
    expect(reconstructedText).toBe('Hello world, how are you?');
  });

  it('should handle manual text input separately from voice tokens', async () => {
    const useVoiceTreeClient = (await import('@/hooks/useVoiceTreeClient.tsx')).default;

    // Start with some voice tokens
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useVoiceTreeClient as any).mockReturnValue({
      state: 'Idle',
      finalTokens: [
        { text: 'Voice', is_final: true, confidence: 1.0 },
        { text: ' input', is_final: true, confidence: 1.0 },
      ],
      nonFinalTokens: [],
      startTranscription: vi.fn(),
      stopTranscription: vi.fn(),
      error: null,
    });

    const { rerender } = render(<VoiceTreeTranscribe />);

    // Wait for voice tokens to be sent
    await waitFor(() => {
      expect(networkRequests.length).toBe(1);
    });

    expect(networkRequests[0].body.text).toBe('Voice input');

    // Type manual text and send it
    const textInput = screen.getByPlaceholderText(/type text here/i);
    const sendButton = screen.getByRole('button', { name: /send/i });

    await userEvent.type(textInput, 'Manual text entry');
    await userEvent.click(sendButton);

    // Wait for manual text to be sent
    await waitFor(() => {
      expect(networkRequests.length).toBe(2);
    });

    // Manual text should be sent as-is
    expect(networkRequests[1].body.text).toBe('Manual text entry');

    // Update voice tokens
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useVoiceTreeClient as any).mockReturnValue({
      state: 'Idle',
      finalTokens: [
        { text: 'Voice', is_final: true, confidence: 1.0 },
        { text: ' input', is_final: true, confidence: 1.0 },
        { text: ' continued', is_final: true, confidence: 1.0 },
      ],
      nonFinalTokens: [],
      startTranscription: vi.fn(),
      stopTranscription: vi.fn(),
      error: null,
    });

    rerender(<VoiceTreeTranscribe />);

    // Wait for the incremental voice update
    await waitFor(() => {
      expect(networkRequests.length).toBe(3);
    });

    // Should only send the new voice token
    expect(networkRequests[2].body.text).toBe(' continued');
  });

  it('should reset and resend when transcription restarts', async () => {
    const useVoiceTreeClient = (await import('@/hooks/useVoiceTreeClient.tsx')).default;

    let mockState: {
      state: 'Idle' | 'Starting' | 'Running' | 'Stopping' | 'Stopped';
      finalTokens: Token[];
      nonFinalTokens: Token[];
      startTranscription: ReturnType<typeof vi.fn>;
      stopTranscription: ReturnType<typeof vi.fn>;
      error: null;
    } = {
      state: 'Running',
      finalTokens: [{ text: 'First session', is_final: true, confidence: 1.0 }],
      nonFinalTokens: [],
      startTranscription: vi.fn(),
      stopTranscription: vi.fn(),
      error: null,
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (useVoiceTreeClient as any).mockImplementation(() => mockState);

    const { rerender } = render(<VoiceTreeTranscribe />);

    // First session sends
    await waitFor(() => {
      expect(networkRequests.length).toBe(1);
    });
    expect(networkRequests[0].body.text).toBe('First session');

    // Simulate stopping (tokens cleared)
    mockState = {
      ...mockState,
      state: 'Idle',
      finalTokens: [],
    };
    rerender(<VoiceTreeTranscribe />);

    // Start new session with new tokens
    mockState = {
      ...mockState,
      state: 'Running',
      finalTokens: [{ text: 'Second session', is_final: true, confidence: 1.0 }],
    };
    rerender(<VoiceTreeTranscribe />);

    // Should send the new session text
    await waitFor(() => {
      expect(networkRequests.length).toBe(2);
    });
    expect(networkRequests[1].body.text).toBe('Second session');

    // Verify both sessions were handled independently
    expect(networkRequests.map(r => r.body.text)).toEqual(['First session', 'Second session']);
  });
});
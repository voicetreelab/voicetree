import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import VoiceTreeTranscribe from '@/renderers/voicetree-transcribe';
import { type Token } from '@soniox/speech-to-text-web';

// Mock dependencies
vi.mock('@/utils/get-api-key', () => ({
  default: () => 'test-api-key'
}));

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Create a mock for useVoiceTreeClient that we can control
let mockFinalTokens: Token[] = [];
let mockNonFinalTokens: Token[] = [];
const mockStartTranscription = vi.fn();
const mockStopTranscription = vi.fn();

vi.mock('@/hooks/useVoiceTreeClient', () => ({
  default: vi.fn(() => ({
    state: 'Idle',
    finalTokens: mockFinalTokens,
    nonFinalTokens: mockNonFinalTokens,
    startTranscription: mockStartTranscription,
    stopTranscription: mockStopTranscription,
    error: null,
  }))
}));

// Helper to create tokens
const createToken = (text: string, is_final: boolean = true): Token => ({
  text,
  is_final,
  speaker: undefined,
  language: undefined,
  confidence: 1.0,
});

describe('VoiceTreeTranscribe - Bug Reproduction', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFinalTokens = [];
    mockNonFinalTokens = [];
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ buffer_length: 100 }),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should NOT send duplicate text when finalTokens updates multiple times rapidly', async () => {
    const { rerender } = render(<VoiceTreeTranscribe />);

    // Simulate the exact scenario from the logs:
    // 1. First transcription: "Cool, so I want to test at what point we get the transcriptions."
    mockFinalTokens = [
      createToken('Cool, so I want to test at what point we get the transcriptions.', true)
    ];

    rerender(<VoiceTreeTranscribe />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    let body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toBe('Cool, so I want to test at what point we get the transcriptions.');

    // 2. Add " And" - simulating incremental update
    mockFinalTokens = [
      createToken('Cool, so I want to test at what point we get the transcriptions.', true),
      createToken(' And', true)
    ];

    rerender(<VoiceTreeTranscribe />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    body = JSON.parse(mockFetch.mock.calls[1][1].body);
    // Should only send the NEW text, not the entire thing again
    expect(body.text).toBe(' And');

    // 3. Add ", um," - another incremental update
    mockFinalTokens = [
      createToken('Cool, so I want to test at what point we get the transcriptions.', true),
      createToken(' And', true),
      createToken(', um,', true)
    ];

    rerender(<VoiceTreeTranscribe />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    body = JSON.parse(mockFetch.mock.calls[2][1].body);
    expect(body.text).toBe(', um,');

    // Verify no duplicate text was sent
    const allSentTexts = mockFetch.mock.calls.map(call => JSON.parse(call[1].body).text);
    expect(allSentTexts).toEqual([
      'Cool, so I want to test at what point we get the transcriptions.',
      ' And',
      ', um,'
    ]);

    // The concatenated text should be the full transcript without duplicates
    const fullText = allSentTexts.join('');
    expect(fullText).toBe('Cool, so I want to test at what point we get the transcriptions. And, um,');
  });

  it('should handle rapid successive updates without duplicating text', async () => {
    const { rerender } = render(<VoiceTreeTranscribe />);

    // Simulate rapid updates like we see in the logs where ", um," gets sent 6 times
    const updates = [
      { tokens: [createToken(' um,', true)], expectedCalls: 1 },
      { tokens: [createToken(' um,', true), createToken(' um,', true)], expectedCalls: 2 },
      { tokens: [createToken(' um,', true), createToken(' um,', true), createToken(' um,', true)], expectedCalls: 3 },
    ];

    for (const update of updates) {
      mockFinalTokens = update.tokens;
      rerender(<VoiceTreeTranscribe />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(update.expectedCalls);
      });
    }

    // Each call should only send the NEW token
    const allSentTexts = mockFetch.mock.calls.map(call => JSON.parse(call[1].body).text);
    expect(allSentTexts).toEqual([' um,', ' um,', ' um,']);
  });

  it('should properly track token count and only send new tokens', async () => {
    const { rerender } = render(<VoiceTreeTranscribe />);

    // Start with empty tokens
    expect(mockFetch).not.toHaveBeenCalled();

    // Add first token
    mockFinalTokens = [createToken('First', true)];
    rerender(<VoiceTreeTranscribe />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    expect(JSON.parse(mockFetch.mock.calls[0][1].body).text).toBe('First');

    // Add second token
    mockFinalTokens = [
      createToken('First', true),
      createToken(' second', true)
    ];
    rerender(<VoiceTreeTranscribe />);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    expect(JSON.parse(mockFetch.mock.calls[1][1].body).text).toBe(' second');

    // If the same tokens array is passed again, should NOT send again
    rerender(<VoiceTreeTranscribe />);

    // Wait a bit to ensure no extra calls
    await new Promise(resolve => setTimeout(resolve, 100));

    // Should still only have 2 calls
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });
});
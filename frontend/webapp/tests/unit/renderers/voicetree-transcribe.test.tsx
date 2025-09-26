import { render, screen, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import VoiceTreeTranscribe from '@/renderers/voicetree-transcribe';
import useVoiceTreeClient from '@/hooks/useVoiceTreeClient';
import { vi } from 'vitest';
import type { RecorderState, Token, ErrorStatus } from '@soniox/speech-to-text-web';

// Types for the mock return value
interface MockUseVoiceTreeClientReturn {
  state: RecorderState;
  finalTokens: Token[];
  nonFinalTokens: Token[];
  startTranscription: vi.Mock;
  stopTranscription: vi.Mock;
  error: { status: ErrorStatus; message: string; errorCode: number | undefined } | null;
}

// Mock the hooks and dependencies
vi.mock('@/hooks/useVoiceTreeClient');
vi.mock('@/hooks/useAutoScroll', () => ({
  default: () => ({ current: null })
}));
vi.mock('@/utils/get-api-key', () => ({
  default: () => 'test-api-key'
}));

// Mock SoundWaveVisualizer to avoid animation issues in tests
vi.mock('@/components/sound-wave-visualizer', () => ({
  default: () => null
}));

// Mock navigator.mediaDevices.getUserMedia
Object.defineProperty(navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: vi.fn().mockResolvedValue({
      getTracks: () => [{
        stop: vi.fn()
      }]
    })
  }
});

describe('VoiceTreeTranscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display non-final tokens while recording', () => {
    // Mock the hook to return non-final tokens (simulating active recording)
    (useVoiceTreeClient as vi.MockedFunction<typeof useVoiceTreeClient>).mockReturnValue({
      state: 'Running',
      finalTokens: [],
      nonFinalTokens: [
        { text: 'Hello', is_final: false },
        { text: ' world', is_final: false }
      ],
      startTranscription: vi.fn(),
      stopTranscription: vi.fn(),
      error: null
    });

    act(() => {
      render(<VoiceTreeTranscribe />);
    });

    // Should show the non-final tokens in the Renderer component
    // Tokens are displayed in the transcription area
    const transcriptionText = screen.getByText('Hello');
    expect(transcriptionText).toBeInTheDocument();

    // The text "world" might be in a separate element, so check parent
    const parent = transcriptionText.parentElement;
    expect(parent?.textContent).toContain('Hello world');
  });

  it('should display both final and non-final tokens', () => {
    // Mock the hook to return both final and non-final tokens
    (useVoiceTreeClient as vi.MockedFunction<typeof useVoiceTreeClient>).mockReturnValue({
      state: 'Running',
      finalTokens: [
        { text: 'This is', is_final: true },
        { text: ' final', is_final: true }
      ],
      nonFinalTokens: [
        { text: ' and this', is_final: false },
        { text: ' is not', is_final: false }
      ],
      startTranscription: vi.fn(),
      stopTranscription: vi.fn(),
      error: null
    });

    act(() => {
      render(<VoiceTreeTranscribe />);
    });

    // All tokens (final + non-final) are shown in the Renderer component
    // Check that the text content includes all the tokens
    const transcriptionText = screen.getByText('This is');
    expect(transcriptionText).toBeInTheDocument();

    // Check the full text is present
    const parent = transcriptionText.parentElement;
    expect(parent?.textContent).toContain('This is final and this is not');
  });

  it('should show placeholder when no tokens', () => {
    // Mock the hook to return no tokens
    (useVoiceTreeClient as vi.MockedFunction<typeof useVoiceTreeClient>).mockReturnValue({
      state: 'Idle',
      finalTokens: [],
      nonFinalTokens: [],
      startTranscription: vi.fn(),
      stopTranscription: vi.fn(),
      error: null
    });

    act(() => {
      render(<VoiceTreeTranscribe />);
    });

    // Should show the placeholder text in the Renderer component
    expect(screen.getByText('Click start to begin transcribing for VoiceTree')).toBeInTheDocument();

    // Input should have the appropriate placeholder
    const input = screen.getByPlaceholderText('Or type text here and press Enter...');
    expect(input).toBeInTheDocument();
  });
});
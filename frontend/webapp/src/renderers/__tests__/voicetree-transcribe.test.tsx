import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import VoiceTreeTranscribe from '../voicetree-transcribe';
import useVoiceTreeClient from '@/hooks/useVoiceTreeClient';
import { vi } from 'vitest';

// Mock the hooks and dependencies
vi.mock('@/hooks/useVoiceTreeClient');
vi.mock('@/hooks/useAutoScroll', () => ({
  default: () => ({ current: null })
}));
vi.mock('@/utils/get-api-key', () => ({
  default: () => 'test-api-key'
}));

describe('VoiceTreeTranscribe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should display non-final tokens while recording', () => {
    // Mock the hook to return non-final tokens (simulating active recording)
    (useVoiceTreeClient as any).mockReturnValue({
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

    render(<VoiceTreeTranscribe />);

    // Should show the non-final tokens in the transcription area
    // Note: ' world' has a leading space, so we check for 'world' with textContent
    const transcriptionArea = screen.getByText('Hello').parentElement;
    expect(transcriptionArea?.textContent).toContain('Hello world');

    // Should NOT show "No history yet..." when we have tokens
    expect(screen.queryByText('No history yet...')).not.toBeInTheDocument();
  });

  it('should display both final and non-final tokens', () => {
    // Mock the hook to return both final and non-final tokens
    (useVoiceTreeClient as any).mockReturnValue({
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

    render(<VoiceTreeTranscribe />);

    // Check that all text is present in the transcription area
    const transcriptionArea = screen.getByText('This is').parentElement;
    expect(transcriptionArea?.textContent).toContain('This is final and this is not');
  });

  it('should show placeholder when no tokens', () => {
    // Mock the hook to return no tokens
    (useVoiceTreeClient as any).mockReturnValue({
      state: 'Idle',
      finalTokens: [],
      nonFinalTokens: [],
      startTranscription: vi.fn(),
      stopTranscription: vi.fn(),
      error: null
    });

    render(<VoiceTreeTranscribe />);

    // Should show the placeholder text
    expect(screen.getByText('Click start to begin transcribing for VoiceTree')).toBeInTheDocument();
  });
});
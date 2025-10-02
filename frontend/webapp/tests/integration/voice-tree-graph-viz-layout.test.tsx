import { describe, test, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import VoiceTreeGraphVizLayout from '@/components/voice-tree-graph-viz-layout';
import { FloatingWindowManagerProvider } from '@/components/floating-windows/context/FloatingWindowManager';

describe('VoiceTreeGraphVizLayout Integration Tests', () => {
  beforeEach(() => {
    // Mock localStorage
    const localStorageMock = {
      getItem: vi.fn(() => 'false'),
      setItem: vi.fn(),
    };
    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });

    // Mock electronAPI
    const electronAPIMock = {
      onInitialFilesLoaded: vi.fn(),
      onFileAdded: vi.fn(),
      onFileChanged: vi.fn(),
      onFileDeleted: vi.fn(),
      onFileWatchingStopped: vi.fn(),
      onInitialScanComplete: vi.fn(),
      onWatchingStarted: vi.fn(),
      removeAllListeners: vi.fn(),
    };
    Object.defineProperty(window, 'electronAPI', {
      value: electronAPIMock,
      writable: true,
    });
  });

  test('should render empty state when no nodes present', () => {
    render(
      <FloatingWindowManagerProvider>
        <VoiceTreeGraphVizLayout />
      </FloatingWindowManagerProvider>
    );

    // Check for empty state message
    expect(screen.getByText('Graph visualization will appear here')).toBeInTheDocument();
    expect(screen.getByText(/Use "Open Folder" to watch markdown files live/)).toBeInTheDocument();
  });

  test('should set up file event listeners on mount', () => {
    const electronAPIMock = (window as any).electronAPI;

    render(
      <FloatingWindowManagerProvider>
        <VoiceTreeGraphVizLayout />
      </FloatingWindowManagerProvider>
    );

    // Verify event listeners were registered
    expect(electronAPIMock.onFileAdded).toHaveBeenCalled();
    expect(electronAPIMock.onFileChanged).toHaveBeenCalled();
    expect(electronAPIMock.onFileDeleted).toHaveBeenCalled();
    expect(electronAPIMock.onFileWatchingStopped).toHaveBeenCalled();
  });
});

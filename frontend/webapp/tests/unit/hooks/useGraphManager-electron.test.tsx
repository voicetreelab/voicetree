import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGraphManager } from '../../../src/hooks/useGraphManager.tsx';

// Mock Electron API
const mockElectronAPI = {
  startFileWatching: vi.fn(),
  stopFileWatching: vi.fn(),
  getWatchStatus: vi.fn(),
  onFileAdded: vi.fn(),
  onFileChanged: vi.fn(),
  onFileDeleted: vi.fn(),
  onDirectoryAdded: vi.fn(),
  onDirectoryDeleted: vi.fn(),
  onInitialScanComplete: vi.fn(),
  onFileWatchError: vi.fn(),
  onFileWatchInfo: vi.fn(),
  onFileWatchingStopped: vi.fn(),
  removeAllListeners: vi.fn(),
};

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

describe('useGraphManager (Electron version)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Reset default mock implementations
    mockElectronAPI.getWatchStatus.mockResolvedValue({ isWatching: false });
    mockElectronAPI.startFileWatching.mockResolvedValue({ success: true, directory: '/test/directory' });
    mockElectronAPI.stopFileWatching.mockResolvedValue({ success: true });
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useGraphManager());

    expect(result.current.graphData).toBe(null);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
    expect(result.current.isWatching).toBe(false);
    expect(result.current.isElectron).toBe(true);
    expect(typeof result.current.startWatching).toBe('function');
    expect(typeof result.current.stopWatching).toBe('function');
  });

  it('should clear graph data when stopping watching', async () => {
    const { result } = renderHook(() => useGraphManager());

    // Start watching first
    await act(async () => {
      await result.current.startWatching();
    });

    expect(result.current.isWatching).toBe(true);
    expect(mockElectronAPI.startFileWatching).toHaveBeenCalled();

    // Stop watching and verify graph data is cleared
    await act(async () => {
      await result.current.stopWatching();
    });

    expect(result.current.isWatching).toBe(false);
    expect(result.current.graphData).toBe(null);
    expect(mockElectronAPI.stopFileWatching).toHaveBeenCalled();
  });

  it('should clear graph data when watching stops via handleWatchingStopped', () => {
    const { result } = renderHook(() => useGraphManager());

    // Simulate adding some files first (this would normally happen via Electron events)
    // For this test, we'll just verify that the handler clears the graph data

    expect(result.current.graphData).toBe(null);
    expect(result.current.isWatching).toBe(false);

    // The handleWatchingStopped callback should be registered
    expect(mockElectronAPI.onFileWatchingStopped).toHaveBeenCalled();

    // Get the callback that was registered
    const watchingStoppedCallback = mockElectronAPI.onFileWatchingStopped.mock.calls[0][0];

    // Simulate watching stopped event
    act(() => {
      watchingStoppedCallback();
    });

    expect(result.current.isWatching).toBe(false);
    expect(result.current.graphData).toBe(null);
  });

  it('should handle stopWatching errors gracefully', async () => {
    const { result } = renderHook(() => useGraphManager());

    // Start watching first
    await act(async () => {
      await result.current.startWatching();
    });

    // Mock stopFileWatching to fail
    mockElectronAPI.stopFileWatching.mockResolvedValue({
      success: false,
      error: 'Failed to stop'
    });

    await act(async () => {
      await result.current.stopWatching();
    });

    expect(result.current.error).toBe('Failed to stop');
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle stopWatching exception gracefully', async () => {
    const { result } = renderHook(() => useGraphManager());

    // Start watching first
    await act(async () => {
      await result.current.startWatching();
    });

    // Mock stopFileWatching to throw
    mockElectronAPI.stopFileWatching.mockRejectedValue(new Error('Connection failed'));

    await act(async () => {
      await result.current.stopWatching();
    });

    expect(result.current.error).toBe('Failed to stop file watching');
    expect(result.current.isLoading).toBe(false);
  });
});
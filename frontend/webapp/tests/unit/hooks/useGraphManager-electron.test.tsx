import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGraphManager } from '@/hooks/useGraphManager';

// Mock Electron API - only the IPC methods useGraphManager actually uses
const mockElectronAPI = {
  startFileWatching: vi.fn(),
  stopFileWatching: vi.fn(),
  getWatchStatus: vi.fn(),
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

  it('should initialize with default state', async () => {
    const { result } = renderHook(() => useGraphManager());

    // Wait for the async initialization in useEffect to complete
    await act(async () => {
      // Give time for the checkStatus async call to complete
      await new Promise(resolve => setTimeout(resolve, 0));
    });

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
    expect(mockElectronAPI.stopFileWatching).toHaveBeenCalled();
  });

  // Removed test - useGraphManager no longer listens to IPC events
  // VoiceTreeGraphVizLayout handles IPC events directly

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
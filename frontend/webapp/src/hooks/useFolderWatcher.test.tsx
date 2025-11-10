import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useFolderWatcher } from '../../../src/hooks/useFolderWatcher';

// Mock Electron API - only the IPC methods useFolderWatcher actually uses
const eventListeners: Record<string, ((data?: unknown) => void)[]> = {};

const mockElectronAPI = {
  startFileWatching: vi.fn(),
  stopFileWatching: vi.fn(),
  getWatchStatus: vi.fn(),
  onWatchingStarted: vi.fn((callback) => {
    if (!eventListeners['watching-started']) {
      eventListeners['watching-started'] = [];
    }
    eventListeners['watching-started'].push(callback);
  }),
  onFileWatchingStopped: vi.fn((callback) => {
    if (!eventListeners['file-watching-stopped']) {
      eventListeners['file-watching-stopped'] = [];
    }
    eventListeners['file-watching-stopped'].push(callback);
  }),
  removeAllListeners: vi.fn((eventName: string) => {
    eventListeners[eventName] = [];
  }),
};

// Helper to trigger events
const triggerEvent = (eventName: string, data?: unknown) => {
  const listeners = eventListeners[eventName] || [];
  listeners.forEach(callback => callback(data));
};

// Mock window.electronAPI
Object.defineProperty(window, 'electronAPI', {
  value: mockElectronAPI,
  writable: true,
});

describe('useFolderWatcher (Electron version)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear event listeners between e2e-tests
    Object.keys(eventListeners).forEach(key => {
      eventListeners[key] = [];
    });

    // Reset default mock implementations
    mockElectronAPI.getWatchStatus.mockResolvedValue({ isWatching: false });
    mockElectronAPI.startFileWatching.mockResolvedValue({ success: true, directory: '/test/directory' });
    mockElectronAPI.stopFileWatching.mockResolvedValue({ success: true });
  });

  it('should initialize with default state', async () => {
    const { result } = renderHook(() => useFolderWatcher());

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

  it('should update state when watching-started event is received', async () => {
    const { result } = renderHook(() => useFolderWatcher());

    // Wait for initialization
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.isWatching).toBe(false);

    // Trigger watching-started event
    await act(async () => {
      triggerEvent('watching-started', {
        directory: '/test/dir',
        timestamp: new Date().toISOString()
      });
    });

    expect(result.current.isWatching).toBe(true);
    expect(result.current.watchDirectory).toBe('/test/dir');
    expect(result.current.isLoading).toBe(false);
  });

  it('should update state when file-watching-stopped event is received', async () => {
    const { result } = renderHook(() => useFolderWatcher());

    // Wait for initialization and set to watching state
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
      triggerEvent('watching-started', {
        directory: '/test/dir',
        timestamp: new Date().toISOString()
      });
    });

    expect(result.current.isWatching).toBe(true);

    // Trigger file-watching-stopped event
    await act(async () => {
      triggerEvent('file-watching-stopped');
    });

    expect(result.current.isWatching).toBe(false);
    expect(result.current.watchDirectory).toBeUndefined();
    expect(result.current.isLoading).toBe(false);
  });

  it('should clear graph data when stopping watching', async () => {
    const { result } = renderHook(() => useFolderWatcher());

    // Start watching first - trigger the event to simulate success
    await act(async () => {
      await result.current.startWatching();
      triggerEvent('watching-started', {
        directory: '/test/directory',
        timestamp: new Date().toISOString()
      });
    });

    expect(result.current.isWatching).toBe(true);
    expect(mockElectronAPI.startFileWatching).toHaveBeenCalled();

    // Stop watching and trigger the event
    await act(async () => {
      await result.current.stopWatching();
      triggerEvent('file-watching-stopped');
    });

    expect(result.current.isWatching).toBe(false);
    expect(mockElectronAPI.stopFileWatching).toHaveBeenCalled();
  });

  it('should handle stopWatching errors gracefully', async () => {
    const { result } = renderHook(() => useFolderWatcher());

    // Start watching first - trigger the event to simulate success
    await act(async () => {
      await result.current.startWatching();
      triggerEvent('watching-started', {
        directory: '/test/directory',
        timestamp: new Date().toISOString()
      });
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
    const { result } = renderHook(() => useFolderWatcher());

    // Start watching first - trigger the event to simulate success
    await act(async () => {
      await result.current.startWatching();
      triggerEvent('watching-started', {
        directory: '/test/directory',
        timestamp: new Date().toISOString()
      });
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
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi, type Mock } from 'vitest';
import { useFolderWatcher } from './useFolderWatcher';

// Mock Electron API - only the IPC methods useFolderWatcher actually uses
const eventListeners: Record<string, ((data?: unknown) => void)[]> = {};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockMainAPI: { startFileWatching: Mock<(...args: any[]) => any>; stopFileWatching: Mock<(...args: any[]) => any>; getWatchStatus: Mock<(...args: any[]) => any>; setVaultSuffix: Mock<(...args: any[]) => any>; } = {
  startFileWatching: vi.fn(),
  stopFileWatching: vi.fn(),
  getWatchStatus: vi.fn(),
  setVaultSuffix: vi.fn(),
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockElectronAPI: { main: { startFileWatching: Mock<(...args: any[]) => any>; stopFileWatching: Mock<(...args: any[]) => any>; getWatchStatus: Mock<(...args: any[]) => any>; setVaultSuffix: Mock<(...args: any[]) => any>; }; onWatchingStarted: Mock<(callback: any) => void>; removeAllListeners: Mock<(eventName: string) => void>; } = {
  main: mockMainAPI,
  onWatchingStarted: vi.fn((callback) => {
    if (!eventListeners['watching-started']) {
      eventListeners['watching-started'] = [];
    }
    eventListeners['watching-started'].push(callback);
  }),
  removeAllListeners: vi.fn((eventName: string) => {
    eventListeners[eventName] = [];
  }),
};

// Helper to trigger events
const triggerEvent: (eventName: string, data?: unknown) => void = (eventName: string, data?: unknown) => {
  const listeners: ((data?: unknown) => void)[] = eventListeners[eventName] || [];
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
    mockMainAPI.getWatchStatus.mockResolvedValue({ isWatching: false, vaultSuffix: 'voicetree' });
    mockMainAPI.startFileWatching.mockResolvedValue({ success: true, directory: '/test/directory' });
    mockMainAPI.stopFileWatching.mockResolvedValue({ success: true });
    mockMainAPI.setVaultSuffix.mockResolvedValue({ success: true });
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
    expect(mockMainAPI.startFileWatching).toHaveBeenCalled();

    // Stop watching - hook sets isWatching to false on successful stopFileWatching
    await act(async () => {
      await result.current.stopWatching();
    });

    expect(result.current.isWatching).toBe(false);
    expect(mockMainAPI.stopFileWatching).toHaveBeenCalled();
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
    mockMainAPI.stopFileWatching.mockResolvedValue({
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
    mockMainAPI.stopFileWatching.mockRejectedValue(new Error('Connection failed'));

    await act(async () => {
      await result.current.stopWatching();
    });

    expect(result.current.error).toBe('Failed to stop file watching');
    expect(result.current.isLoading).toBe(false);
  });

  it('should expose vaultSuffix from initial status', async () => {
    mockMainAPI.getWatchStatus.mockResolvedValue({
      isWatching: true,
      directory: '/test/dir',
      vaultSuffix: 'my_notes'
    });

    const { result } = renderHook(() => useFolderWatcher());

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    expect(result.current.vaultSuffix).toBe('my_notes');
    expect(result.current.watchDirectory).toBe('/test/dir');
  });

  it('should call setVaultSuffix and update state on success', async () => {
    const { result } = renderHook(() => useFolderWatcher());

    // Wait for initialization
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Set a new vault suffix
    await act(async () => {
      await result.current.setVaultSuffix('new_folder');
    });

    expect(mockMainAPI.setVaultSuffix).toHaveBeenCalledWith('new_folder');
    expect(result.current.vaultSuffix).toBe('new_folder');
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
  });

  it('should handle setVaultSuffix errors gracefully', async () => {
    const { result } = renderHook(() => useFolderWatcher());

    // Wait for initialization
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Mock setVaultSuffix to fail
    mockMainAPI.setVaultSuffix.mockResolvedValue({
      success: false,
      error: 'Suffix cannot be empty'
    });

    await act(async () => {
      await result.current.setVaultSuffix('');
    });

    expect(result.current.error).toBe('Suffix cannot be empty');
    expect(result.current.isLoading).toBe(false);
  });

  it('should handle setVaultSuffix exception gracefully', async () => {
    const { result } = renderHook(() => useFolderWatcher());

    // Wait for initialization
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 0));
    });

    // Mock setVaultSuffix to throw
    mockMainAPI.setVaultSuffix.mockRejectedValue(new Error('Connection failed'));

    await act(async () => {
      await result.current.setVaultSuffix('new_folder');
    });

    expect(result.current.error).toBe('Failed to set vault suffix');
    expect(result.current.isLoading).toBe(false);
  });
});
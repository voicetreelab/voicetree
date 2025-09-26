import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useGraphManager } from '../../../src/hooks/useGraphManager-fileobserver';

// Mock the file observer module
vi.mock('../../../src/lib/file-observer', () => {
  const mockObserver = {
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
    isWatching: false,
    config: undefined,
  };

  return {
    createFileObserver: vi.fn(() => mockObserver),
    FileObserverError: class FileObserverError extends Error {
      constructor(message: string, public code: string) {
        super(message);
        this.name = 'FileObserverError';
      }
    },
  };
});

describe('useGraphManager (FileObserver version)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useGraphManager());

    expect(result.current.graphData).toEqual({ nodes: [], edges: [] });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBe(null);
    expect(result.current.isWatching).toBe(false);
    expect(typeof result.current.start).toBe('function');
    expect(typeof result.current.stop).toBe('function');
  });

  it('should handle start configuration', async () => {
    const { result } = renderHook(() => useGraphManager());

    const config = {
      watchDirectory: '/test/path',
      extensions: ['.md'],
      recursive: true,
      debounceMs: 100,
    };

    await act(async () => {
      await result.current.start(config);
    });

    // The mock observer's start method should have been called
    const { createFileObserver } = await import('../../../src/lib/file-observer');
    const mockObserver = createFileObserver();
    expect(mockObserver.start).toHaveBeenCalledWith(config);
  });

  it('should handle stop correctly', async () => {
    const { result } = renderHook(() => useGraphManager());

    const config = {
      watchDirectory: '/test/path',
      extensions: ['.md'],
    };

    // First start watching
    await act(async () => {
      await result.current.start(config);
    });

    // Then stop
    await act(async () => {
      await result.current.stop();
    });

    const { createFileObserver } = await import('../../../src/lib/file-observer');
    const mockObserver = createFileObserver();
    expect(mockObserver.stop).toHaveBeenCalled();
  });

  it('should handle errors during start', async () => {
    const { createFileObserver } = await import('../../../src/lib/file-observer');
    const mockObserver = createFileObserver();
    const startError = new Error('Failed to start');
    (mockObserver.start as any).mockRejectedValueOnce(startError);

    const { result } = renderHook(() => useGraphManager());

    const config = {
      watchDirectory: '/test/path',
      extensions: ['.md'],
    };

    // Suppress console.error for this test since it's expected
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await act(async () => {
      await expect(result.current.start(config)).rejects.toThrow('Failed to start');
    });

    expect(result.current.error).toEqual(startError);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isWatching).toBe(false);

    // Restore console.error
    consoleSpy.mockRestore();
  });

  it('should transform graph data correctly with empty map', () => {
    const { result } = renderHook(() => useGraphManager());

    expect(result.current.graphData).toEqual({
      nodes: [],
      edges: [],
    });
  });

  it('should provide proper return interface', () => {
    const { result } = renderHook(() => useGraphManager());

    expect(result.current).toHaveProperty('graphData');
    expect(result.current).toHaveProperty('isLoading');
    expect(result.current).toHaveProperty('error');
    expect(result.current).toHaveProperty('start');
    expect(result.current).toHaveProperty('stop');
    expect(result.current).toHaveProperty('isWatching');

    // Type checks
    expect(Array.isArray(result.current.graphData.nodes)).toBe(true);
    expect(Array.isArray(result.current.graphData.edges)).toBe(true);
    expect(typeof result.current.isLoading).toBe('boolean');
    expect(typeof result.current.isWatching).toBe('boolean');
    expect(typeof result.current.start).toBe('function');
    expect(typeof result.current.stop).toBe('function');
  });
});
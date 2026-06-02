import { useState, useEffect, useCallback } from 'react';
import type { WatchStatus } from '@/shell/hostApi';


interface UseFolderWatcherReturn {
  // File watching state
  isWatching: boolean;
  isLoading: boolean;
  watchDirectory: string | undefined;
  error: string | null;

  // Actions
  startWatching: () => Promise<void>;
  stopWatching: () => Promise<void>;
  clearError: () => void;

  // Utility
  isElectron: boolean;
}

export function useFolderWatcher(): UseFolderWatcherReturn {
  // State for file watching
  const [watchStatus, setWatchStatus] = useState<WatchStatus>({ isWatching: false });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if we're running in Electron
  const isElectron: boolean = window.hostAPI !== undefined;

  // Get initial watch status on mount
  useEffect(() => {
    if (!isElectron) return;

    const checkStatus: () => Promise<void> = async () => {
      try {
        const status: { readonly isWatching: boolean; readonly directory: string | undefined } = await window.hostAPI!.main.getWatchStatus();
        //console.log('[DEBUG] Initial watch status from hostAPI:', status);
        // Convert null to undefined to match WatchStatus type
        setWatchStatus({ isWatching: status.isWatching, directory: status.directory ?? undefined });
      } catch (err) {
        console.error('Failed to get watch status:', err);
        setError('Failed to get watch status');
      }
    };

    void checkStatus();
  }, [isElectron]);

  // Listen to project lifecycle events to stay in sync
  useEffect(() => {
    if (!isElectron || !window.hostAPI) return;

    const cleanupReady = window.hostAPI.onProjectReady?.((data: { path: string }) => {
      setWatchStatus({ isWatching: true, directory: data.path });
      setIsLoading(false);
      setError(null);
    }) ?? (() => {});
    const cleanupSwitching = window.hostAPI.onProjectSwitching?.(() => {
      setIsLoading(true);
      setError(null);
    }) ?? (() => {});
    const cleanupLost = window.hostAPI.onProjectLost?.((data: { error?: string }) => {
      setIsLoading(false);
      setError(data.error ?? 'Project unavailable');
    }) ?? (() => {});

    return () => {
      cleanupReady();
      cleanupSwitching();
      cleanupLost();
    };
  }, [isElectron]);

  // Start watching function
  const startWatching: () => Promise<void> = useCallback(async () => {
    if (!isElectron) {
      console.error('[useFolderWatcher] Not in Electron, cannot start watching');
      return;
    }

    //console.log('[useFolderWatcher] startWatching called, current watchStatus:', watchStatus);
    setIsLoading(true);
    setError(null);

    try {
      if (!watchStatus.directory) {
        setError('No project selected');
        setIsLoading(false);
        return;
      }
      await window.hostAPI!.main.openProject(watchStatus.directory);
      setWatchStatus({ isWatching: true, directory: watchStatus.directory });
      setIsLoading(false);
    } catch (_err) {
      //console.log('[DEBUG] startWatching error:', _err);
      setError('Failed to open project');
      setIsLoading(false);
    }
  }, [isElectron, watchStatus.directory]);

  // Stop watching function
  const stopWatching: () => Promise<void> = useCallback(async () => {
    if (!isElectron) return;

    //console.log('[DEBUG] stopWatching called, current watchStatus:', watchStatus);
    setIsLoading(true);
    setError(null);

    try {
      const result: { readonly success: boolean; readonly error?: string; } = await window.hostAPI!.main.stopFileWatching();
      //console.log('[DEBUG] stopFileWatching result:', result);
      if (result.success) {
        // Reset state immediately after successful IPC call
        // Event will also sync state, but we do it here to ensure UI-edge responsiveness
        setWatchStatus({ isWatching: false });
        setIsLoading(false);
      } else {
        setError(result.error ?? 'Failed to stop watching');
        setIsLoading(false);
      }
    } catch (_err) {
      //console.log('[DEBUG] stopWatching error:', _err);
      setError('Failed to stop file watching');
      setIsLoading(false);
    }
  }, [isElectron]);

  // Clear error function
  const clearError: () => void = useCallback(() => {
    setError(null);
  }, []);

  return {
    // File watching state
    isWatching: watchStatus.isWatching,
    isLoading,
    watchDirectory: watchStatus.directory,
    error,

    // Actions
    startWatching,
    stopWatching,
    clearError,

    // Utility
    isElectron,
  };
}

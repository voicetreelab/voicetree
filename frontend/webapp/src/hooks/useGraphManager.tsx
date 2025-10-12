import { useState, useEffect, useCallback } from 'react';
import type { WatchStatus } from '@/types/electron';


interface UseGraphManagerReturn {
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

export function useGraphManager(): UseGraphManagerReturn {
  // State for file watching
  const [watchStatus, setWatchStatus] = useState<WatchStatus>({ isWatching: false });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Check if we're running in Electron
  const isElectron = window.electronAPI !== undefined;

  // Get initial watch status on mount
  useEffect(() => {
    if (!isElectron) return;

    const checkStatus = async () => {
      try {
        const status = await window.electronAPI!.getWatchStatus();
        console.log('[DEBUG] Initial watch status from electronAPI:', status);
        setWatchStatus(status);
      } catch (err) {
        console.error('Failed to get watch status:', err);
      }
    };

    checkStatus();
  }, [isElectron]);

  // Listen to watching-started and file-watching-stopped events to stay in sync
  useEffect(() => {
    if (!isElectron || !window.electronAPI?.onWatchingStarted) return;

    const handleWatchingStarted = (data: { directory: string; timestamp: string }) => {
      console.log('[useGraphManager] watching-started event received:', data.directory);
      setWatchStatus({ isWatching: true, directory: data.directory });
      setIsLoading(false);
      setError(null);
    };

    const handleWatchingStopped = () => {
      console.log('[useGraphManager] file-watching-stopped event received');
      setWatchStatus({ isWatching: false });
      setIsLoading(false);
    };

    // Register event listeners
    window.electronAPI.onWatchingStarted(handleWatchingStarted);
    window.electronAPI.onFileWatchingStopped(handleWatchingStopped);

    // Cleanup
    return () => {
      window.electronAPI?.removeAllListeners?.('watching-started');
      window.electronAPI?.removeAllListeners?.('file-watching-stopped');
    };
  }, [isElectron]);

  // Start watching function
  const startWatching = useCallback(async () => {
    if (!isElectron) return;

    console.log('[DEBUG] startWatching called, current watchStatus:', watchStatus);
    setIsLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI!.startFileWatching();
      console.log('[DEBUG] startFileWatching result:', result);
      if (result.success) {
        // Don't set watchStatus or isLoading here - the watching-started event will handle it
        // This prevents race conditions and ensures state is in sync with main process
      } else {
        setError(result.error || 'Failed to start watching');
        setIsLoading(false);
      }
    } catch (err) {
      console.log('[DEBUG] startWatching error:', err);
      setError('Failed to start file watching');
      setIsLoading(false);
    }
  }, [isElectron, watchStatus]);

  // Stop watching function
  const stopWatching = useCallback(async () => {
    if (!isElectron) return;

    console.log('[DEBUG] stopWatching called, current watchStatus:', watchStatus);
    setIsLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI!.stopFileWatching();
      console.log('[DEBUG] stopFileWatching result:', result);
      if (result.success) {
        // Don't set watchStatus or isLoading here - the file-watching-stopped event will handle it
        // This prevents race conditions and ensures state is in sync with main process
      } else {
        setError(result.error || 'Failed to stop watching');
        setIsLoading(false);
      }
    } catch (err) {
      console.log('[DEBUG] stopWatching error:', err);
      setError('Failed to stop file watching');
      setIsLoading(false);
    }
  }, [isElectron, watchStatus]);

  // Clear error function
  const clearError = useCallback(() => {
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

export default useGraphManager;
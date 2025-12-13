import { useState, useEffect, useCallback } from 'react';
import type { WatchStatus } from '@/shell/electron';


interface UseFolderWatcherReturn {
  // File watching state
  isWatching: boolean;
  isLoading: boolean;
  watchDirectory: string | undefined;
  vaultSuffix: string | undefined;
  error: string | null;

  // Actions
  startWatching: () => Promise<void>;
  stopWatching: () => Promise<void>;
  setVaultSuffix: (suffix: string) => Promise<void>;
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
  const isElectron: boolean = window.electronAPI !== undefined;

  // Get initial watch status on mount
  useEffect(() => {
    if (!isElectron) return;

    const checkStatus: () => Promise<void> = async () => {
      try {
        const status: { readonly isWatching: boolean; readonly directory: string | undefined; readonly vaultSuffix: string } = await window.electronAPI!.main.getWatchStatus();
        console.log('[DEBUG] Initial watch status from electronAPI:', status);
        // Convert null to undefined to match WatchStatus type
        setWatchStatus({ isWatching: status.isWatching, directory: status.directory ?? undefined, vaultSuffix: status.vaultSuffix || undefined });
      } catch (err) {
        console.error('Failed to get watch status:', err);
        setError('Failed to get watch status');
      }
    };

    void checkStatus();
  }, [isElectron]);

  // Listen to watching-started and file-watching-stopped events to stay in sync
  useEffect(() => {
    if (!isElectron || !window.electronAPI?.onWatchingStarted) return;

    const handleWatchingStarted: (data: { directory: string; vaultSuffix?: string; timestamp: string; }) => void = (data: { directory: string; vaultSuffix?: string; timestamp: string }) => {
      console.log('[useFolderWatcher] watching-started event received:', data.directory, 'suffix:', data.vaultSuffix);
      setWatchStatus({ isWatching: true, directory: data.directory, vaultSuffix: data.vaultSuffix || undefined });
      setIsLoading(false);
      setError(null);
    };

    const handleWatchingStopped: () => void = () => {
      console.log('[useFolderWatcher] file-watching-stopped event received');
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
  const startWatching: () => Promise<void> = useCallback(async () => {
    if (!isElectron) {
      console.error('[useFolderWatcher] Not in Electron, cannot start watching');
      return;
    }

    console.log('[useFolderWatcher] startWatching called, current watchStatus:', watchStatus);
    setIsLoading(true);
    setError(null);

    try {
      console.log('[useFolderWatcher] Calling window.electronAPI.startFileWatching()...');
      const result: { readonly success: boolean; readonly directory?: string; readonly error?: string; } = await window.electronAPI!.main.startFileWatching();
      console.log('[useFolderWatcher] startFileWatching IPC result:', result);
      if (result.success) {
        // Reset state immediately after successful IPC call
        // Event will also sync state with directory info, but we do it here for UI-edge responsiveness
        if (result.directory) {
          setWatchStatus({ isWatching: true, directory: result.directory });
        }
        setIsLoading(false);
      } else {
        setError(result.error ?? 'Failed to start watching');
        setIsLoading(false);
      }
    } catch (err) {
      console.log('[DEBUG] startWatching error:', err);
      setError('Failed to start file watching');
      setIsLoading(false);
    }
  }, [isElectron, watchStatus]);

  // Stop watching function
  const stopWatching: () => Promise<void> = useCallback(async () => {
    if (!isElectron) return;

    console.log('[DEBUG] stopWatching called, current watchStatus:', watchStatus);
    setIsLoading(true);
    setError(null);

    try {
      const result: { readonly success: boolean; readonly error?: string; } = await window.electronAPI!.main.stopFileWatching();
      console.log('[DEBUG] stopFileWatching result:', result);
      if (result.success) {
        // Reset state immediately after successful IPC call
        // Event will also sync state, but we do it here to ensure UI-edge responsiveness
        setWatchStatus({ isWatching: false });
        setIsLoading(false);
      } else {
        setError(result.error ?? 'Failed to stop watching');
        setIsLoading(false);
      }
    } catch (err) {
      console.log('[DEBUG] stopWatching error:', err);
      setError('Failed to stop file watching');
      setIsLoading(false);
    }
  }, [isElectron, watchStatus]);

  // Clear error function
  const clearError: () => void = useCallback(() => {
    setError(null);
  }, []);

  // Set vault suffix function
  const setVaultSuffixAction: (suffix: string) => Promise<void> = useCallback(async (suffix: string) => {
    if (!isElectron) {
      console.error('[useFolderWatcher] Not in Electron, cannot set vault suffix');
      return;
    }

    console.log('[useFolderWatcher] setVaultSuffix called with:', suffix);
    setIsLoading(true);
    setError(null);

    try {
      const result: { readonly success: boolean; readonly error?: string } = await window.electronAPI!.main.setVaultSuffix(suffix);
      console.log('[useFolderWatcher] setVaultSuffix result:', result);
      if (result.success) {
        // Update local state - the watching-started event will also sync this
        setWatchStatus(prev => ({ ...prev, vaultSuffix: suffix || undefined }));
        setIsLoading(false);
      } else {
        setError(result.error ?? 'Failed to set vault suffix');
        setIsLoading(false);
      }
    } catch (err) {
      console.log('[DEBUG] setVaultSuffix error:', err);
      setError('Failed to set vault suffix');
      setIsLoading(false);
    }
  }, [isElectron]);

  return {
    // File watching state
    isWatching: watchStatus.isWatching,
    isLoading,
    watchDirectory: watchStatus.directory,
    vaultSuffix: watchStatus.vaultSuffix,
    error,

    // Actions
    startWatching,
    stopWatching,
    setVaultSuffix: setVaultSuffixAction,
    clearError,

    // Utility
    isElectron,
  };
}

export default useFolderWatcher;
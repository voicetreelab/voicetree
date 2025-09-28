import { useState, useEffect, useCallback } from 'react';
import type { WatchStatus, FileEvent, ErrorEvent } from '@/types/electron';


interface UseGraphManagerReturn {
  // File watching state
  isWatching: boolean;
  isLoading: boolean;
  watchDirectory: string | undefined;
  error: string | null;

  // File events
  fileEvents: Array<{ type: string; data: FileEvent | ErrorEvent | { directory?: string; message?: string } | Record<string, never>; timestamp: Date }>;

  // Actions
  startWatching: () => Promise<void>;
  stopWatching: () => Promise<void>;
  clearError: () => void;
  clearFileEvents: () => void;
  syncWatchingState: () => Promise<void>;  // NEW

  // Utility
  isElectron: boolean;
}

export function useGraphManager(): UseGraphManagerReturn {
  // State for file watching
  const [watchStatus, setWatchStatus] = useState<WatchStatus>({ isWatching: false });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileEvents, setFileEvents] = useState<Array<{ type: string; data: FileEvent | ErrorEvent | { directory?: string; message?: string } | Record<string, never>; timestamp: Date }>>([]);

  // Check if we're running in Electron
  const isElectron = window.electronAPI !== undefined;


  // Add file event to history
  const addFileEvent = useCallback((type: string, data: FileEvent | ErrorEvent | { directory?: string; message?: string } | Record<string, never>) => {
    setFileEvents(prev => [
      { type, data, timestamp: new Date() },
      ...prev.slice(0, 49) // Keep only last 50 events
    ]);
  }, []);

  // Handle file events - just track them, don't process
  const handleFileAdded = useCallback((data: FileEvent) => {
    // console.log('useGraphManager: File added:', data.path);
    addFileEvent('File Added', data);
  }, [addFileEvent]);

  const handleFileChanged = useCallback((data: FileEvent) => {
    // console.log('useGraphManager: File changed:', data.path);
    addFileEvent('File Changed', data);
  }, [addFileEvent]);

  const handleFileDeleted = useCallback((data: FileEvent) => {
    // console.log('useGraphManager: File deleted:', data.path);
    addFileEvent('File Deleted', data);
  }, [addFileEvent]);

  // Handle initial scan complete
  const handleInitialScanComplete = useCallback((data: { directory: string }) => {
    console.log('[DEBUG] handleInitialScanComplete called with data:', data);
    addFileEvent('Scan Complete', data);
    setIsLoading(false);
  }, [addFileEvent]);

  // Handle errors
  const handleError = useCallback((data: ErrorEvent) => {
    addFileEvent('Error', data);
    setError(data.message);
    setIsLoading(false);
  }, [addFileEvent]);

  // Handle watching stopped
  const handleWatchingStopped = useCallback(() => {
    console.log('[DEBUG] handleWatchingStopped called');
    setWatchStatus({ isWatching: false });
    addFileEvent('Watching Stopped', {});
    setIsLoading(false);
  }, [addFileEvent]);

  // Handle watching started (for state sync when initiated externally)
  const handleWatchingStarted = useCallback((data: { directory: string; timestamp: string }) => {
    console.log('[DEBUG] handleWatchingStarted called with data:', data);
    setWatchStatus({ isWatching: true, directory: data.directory });
    addFileEvent('Watching Started', data);
    setIsLoading(false);
  }, [addFileEvent]);

  // Set up event listeners
  useEffect(() => {
    if (!isElectron) return;

    // Get initial watch status
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

    // Set up event listeners
    // console.log('useGraphManager: Setting up event listeners on window.electronAPI');
    // console.log('useGraphManager: electronAPI available:', !!window.electronAPI);
    window.electronAPI!.onWatchingStarted?.(handleWatchingStarted);
    window.electronAPI!.onFileAdded(handleFileAdded);
    window.electronAPI!.onFileChanged(handleFileChanged);
    window.electronAPI!.onFileDeleted(handleFileDeleted);
    window.electronAPI!.onDirectoryAdded((data) => addFileEvent('Directory Added', data));
    window.electronAPI!.onDirectoryDeleted((data) => addFileEvent('Directory Deleted', data));
    window.electronAPI!.onInitialScanComplete(handleInitialScanComplete);
    window.electronAPI!.onFileWatchError(handleError);
    window.electronAPI!.onFileWatchInfo((data) => addFileEvent('Info', data));
    window.electronAPI!.onFileWatchingStopped(handleWatchingStopped);
    // console.log('useGraphManager: All event listeners registered');

    return () => {
      // Cleanup listeners
      window.electronAPI!.removeAllListeners('watching-started');
      window.electronAPI!.removeAllListeners('file-added');
      window.electronAPI!.removeAllListeners('file-changed');
      window.electronAPI!.removeAllListeners('file-deleted');
      window.electronAPI!.removeAllListeners('directory-added');
      window.electronAPI!.removeAllListeners('directory-deleted');
      window.electronAPI!.removeAllListeners('initial-scan-complete');
      window.electronAPI!.removeAllListeners('file-watch-error');
      window.electronAPI!.removeAllListeners('file-watch-info');
      window.electronAPI!.removeAllListeners('file-watching-stopped');
    };
  }, [isElectron, handleFileAdded, handleFileChanged, handleFileDeleted, handleInitialScanComplete, handleError, handleWatchingStopped, handleWatchingStarted, addFileEvent]);

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
        setWatchStatus({ isWatching: true, directory: result.directory });
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
        setWatchStatus({ isWatching: false });
      } else {
        setError(result.error || 'Failed to stop watching');
      }
    } catch (err) {
      console.log('[DEBUG] stopWatching error:', err);
      setError('Failed to stop file watching');
    } finally {
      setIsLoading(false);
    }
  }, [isElectron, watchStatus]);

  // Clear error function
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Clear file events function
  const clearFileEvents = useCallback(() => {
    setFileEvents([]);
  }, []);

  // New: Sync watching state for external initiation
  const syncWatchingState = useCallback(async () => {
    if (!isElectron) return;

    try {
      const status = await window.electronAPI!.getWatchStatus();
      setWatchStatus(status);

      if (status.isWatching) {
        addFileEvent('Watching Synced', { directory: status.directory });
      }
    } catch (err) {
      console.error('Failed to sync watch status:', err);
    }
  }, [isElectron, addFileEvent]);

  return {
    // File watching state
    isWatching: watchStatus.isWatching,
    isLoading,
    watchDirectory: watchStatus.directory,
    error,

    // File events
    fileEvents,

    // Actions
    startWatching,
    stopWatching,
    clearError,
    clearFileEvents,
    syncWatchingState,  // NEW

    // Utility
    isElectron,
  };
}

export default useGraphManager;
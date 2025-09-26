import { useState, useEffect, useCallback, useRef } from 'react';
import { MarkdownParser, type GraphData } from '@/graph-core/data';
import type { ElectronAPI, WatchStatus, FileEvent, ErrorEvent } from '@/types/electron';


interface UseGraphManagerReturn {
  // Graph data
  graphData: GraphData | null;

  // File watching state
  isWatching: boolean;
  isLoading: boolean;
  watchDirectory: string | undefined;
  error: string | null;

  // File events
  fileEvents: Array<{ type: string; data: any; timestamp: Date }>;

  // Actions
  startWatching: () => Promise<void>;
  stopWatching: () => Promise<void>;
  clearError: () => void;
  clearFileEvents: () => void;

  // Utility
  isElectron: boolean;
}

export function useGraphManager(): UseGraphManagerReturn {
  // State for graph data
  const [graphData, setGraphData] = useState<GraphData | null>(null);

  // State for file watching
  const [watchStatus, setWatchStatus] = useState<WatchStatus>({ isWatching: false });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fileEvents, setFileEvents] = useState<Array<{ type: string; data: any; timestamp: Date }>>([]);

  // Refs for managing file data
  const markdownFiles = useRef<Map<string, string>>(new Map());

  // Check if we're running in Electron
  const isElectron = window.electronAPI !== undefined;

  // Update graph data when markdown files change
  const updateGraphData = useCallback(async () => {
    if (markdownFiles.current.size > 0) {
      try {
        const newGraphData = await MarkdownParser.parseDirectory(markdownFiles.current);
        setGraphData(newGraphData);
      } catch (err) {
        console.error('Failed to parse markdown files:', err);
        setError('Failed to parse markdown files');
      }
    } else {
      setGraphData(null);
    }
  }, []);

  // Add file event to history
  const addFileEvent = useCallback((type: string, data: any) => {
    setFileEvents(prev => [
      { type, data, timestamp: new Date() },
      ...prev.slice(0, 49) // Keep only last 50 events
    ]);
  }, []);

  // Handle file addition
  const handleFileAdded = useCallback((data: FileEvent) => {
    console.log('useGraphManager: handleFileAdded called with:', data);
    if (data.path.endsWith('.md') && data.content) {
      console.log('useGraphManager: Processing markdown file, adding to map');
      markdownFiles.current.set(data.path, data.content);
      updateGraphData();
    } else {
      console.log('useGraphManager: File ignored (not .md or no content)');
    }
    addFileEvent('File Added', data);
  }, [updateGraphData, addFileEvent]);

  // Handle file changes
  const handleFileChanged = useCallback((data: FileEvent) => {
    if (data.path.endsWith('.md') && data.content) {
      markdownFiles.current.set(data.path, data.content);
      updateGraphData();
    }
    addFileEvent('File Changed', data);
  }, [updateGraphData, addFileEvent]);

  // Handle file deletion
  const handleFileDeleted = useCallback((data: FileEvent) => {
    if (data.path.endsWith('.md')) {
      markdownFiles.current.delete(data.path);
      updateGraphData();
    }
    addFileEvent('File Deleted', data);
  }, [updateGraphData, addFileEvent]);

  // Handle initial scan complete
  const handleInitialScanComplete = useCallback((data: { directory: string }) => {
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
    setWatchStatus({ isWatching: false });
    addFileEvent('Watching Stopped', {});
    setIsLoading(false);
    // Clear the markdown files when watching stops
    markdownFiles.current.clear();
    setGraphData(null);
  }, [addFileEvent]);

  // Set up event listeners
  useEffect(() => {
    if (!isElectron) return;

    // Get initial watch status
    const checkStatus = async () => {
      try {
        const status = await window.electronAPI!.getWatchStatus();
        setWatchStatus(status);
      } catch (err) {
        console.error('Failed to get watch status:', err);
      }
    };

    checkStatus();

    // Set up event listeners
    console.log('useGraphManager: Setting up event listeners on window.electronAPI');
    console.log('useGraphManager: electronAPI available:', !!window.electronAPI);
    window.electronAPI!.onFileAdded(handleFileAdded);
    window.electronAPI!.onFileChanged(handleFileChanged);
    window.electronAPI!.onFileDeleted(handleFileDeleted);
    window.electronAPI!.onDirectoryAdded((data) => addFileEvent('Directory Added', data));
    window.electronAPI!.onDirectoryDeleted((data) => addFileEvent('Directory Deleted', data));
    window.electronAPI!.onInitialScanComplete(handleInitialScanComplete);
    window.electronAPI!.onFileWatchError(handleError);
    window.electronAPI!.onFileWatchInfo((data) => addFileEvent('Info', data));
    window.electronAPI!.onFileWatchingStopped(handleWatchingStopped);
    console.log('useGraphManager: All event listeners registered');

    return () => {
      // Cleanup listeners
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
  }, [isElectron, handleFileAdded, handleFileChanged, handleFileDeleted, handleInitialScanComplete, handleError, handleWatchingStopped, addFileEvent]);

  // Start watching function
  const startWatching = useCallback(async () => {
    if (!isElectron) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI!.startFileWatching();
      if (result.success) {
        setWatchStatus({ isWatching: true, directory: result.directory });
      } else {
        setError(result.error || 'Failed to start watching');
        setIsLoading(false);
      }
    } catch (err) {
      setError('Failed to start file watching');
      setIsLoading(false);
    }
  }, [isElectron]);

  // Stop watching function
  const stopWatching = useCallback(async () => {
    if (!isElectron) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await window.electronAPI!.stopFileWatching();
      if (result.success) {
        setWatchStatus({ isWatching: false });
        // Clear files and graph data when stopping
        markdownFiles.current.clear();
        setGraphData(null);
      } else {
        setError(result.error || 'Failed to stop watching');
      }
    } catch (err) {
      setError('Failed to stop file watching');
    } finally {
      setIsLoading(false);
    }
  }, [isElectron]);

  // Clear error function
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Clear file events function
  const clearFileEvents = useCallback(() => {
    setFileEvents([]);
  }, []);

  return {
    // Graph data
    graphData,
    markdownFiles,

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

    // Utility
    isElectron,
  };
}

export default useGraphManager;
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MarkdownParser, type GraphData, type ParsedNode } from '@/graph-core/data';
import {
  createFileObserver,
  type FileObserverApi,
  type FileObserverConfig,
  type VFile
} from '@/lib/file-observer';

/**
 * Interface for the useGraphManager hook return value
 */
interface UseGraphManagerReturn {
  /** Current graph data transformed from parsed nodes */
  graphData: GraphData;
  /** Whether the file observer is currently loading/starting */
  isLoading: boolean;
  /** Any error that occurred during file observation or parsing */
  error: Error | null;
  /** Start watching the specified directory */
  start: (config: FileObserverConfig) => Promise<void>;
  /** Stop watching and clean up resources */
  stop: () => Promise<void>;
  /** Whether the file observer is currently watching */
  isWatching: boolean;
  /** Current watch directory from config */
  watchDirectory: string | undefined;
  /** Start watching with directory chooser (for compatibility) */
  startWatching: () => Promise<void>;
  /** Stop watching (alias for stop method) */
  stopWatching: () => Promise<void>;
  /** Clear current error */
  clearError: () => void;
  /** Whether running in Electron environment */
  isElectron: boolean;
  /** Layout strategy to use: 'reingold-tilford' for bulk load, 'seed-park-relax' for incremental */
  layoutStrategy: 'reingold-tilford' | 'seed-park-relax';
}

/**
 * React hook that bridges FileObserverApi with the graph data model.
 *
 * This hook:
 * - Manages a Map<string, ParsedNode> as the source of truth for file data
 * - Handles FileObserver events (ready, add, change, delete, error)
 * - Transforms the map to GraphData using useMemo for efficiency
 * - Provides start/stop functions for UI control
 * - Handles loading states and comprehensive error management
 * - Uses MarkdownParser.parseMarkdownFile() to convert VFile to ParsedNode
 *
 * @example
 * ```tsx
 * const { graphData, isLoading, error, start, stop, isWatching } = useGraphManager();
 *
 * const handleStart = async () => {
 *   try {
 *     await start({
 *       watchDirectory: '/path/to/markdown/files',
 *       extensions: ['.md'],
 *       recursive: true,
 *       debounceMs: 100
 *     });
 *   } catch (err) {
 *     console.error('Failed to start watching:', err);
 *   }
 * };
 * ```
 */
export function useGraphManager(): UseGraphManagerReturn {
  // Core state management
  const [parsedNodesMap, setParsedNodesMap] = useState<Map<string, ParsedNode>>(new Map());
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  // File observer instance - maintained across renders
  const fileObserverRef = useRef<FileObserverApi | null>(null);
  const [isWatching, setIsWatching] = useState(false);
  const [currentConfig, setCurrentConfig] = useState<FileObserverConfig | undefined>(undefined);

  // Track whether we're in initial bulk load phase (before 'ready') or incremental phase (after 'ready')
  const [isInitialLoad, setIsInitialLoad] = useState(true);

  // Initialize file observer on first render
  useEffect(() => {
    if (!fileObserverRef.current) {
      fileObserverRef.current = createFileObserver();
    }
  }, []);

  /**
   * Handle file observer ready event
   */
  const handleReady = useCallback(() => {
    console.log('File observer is ready and watching');
    setIsLoading(false);
    setError(null);
    setIsWatching(true);
    // Switch from bulk load to incremental mode after initial load completes
    setIsInitialLoad(false);
  }, []);

  /**
   * Handle file added event - parse and add to map
   */
  const handleAdd = useCallback((file: VFile) => {
    try {
      console.log('File added:', file.path);
      const parsedNode = MarkdownParser.parseMarkdownFile(file.content, file.path);

      setParsedNodesMap(prevMap => {
        const newMap = new Map(prevMap);
        newMap.set(file.path, parsedNode);
        return newMap;
      });

      setError(null);
    } catch (err) {
      const parseError = err instanceof Error ? err : new Error(`Failed to parse added file: ${file.path}`);
      console.error('Error parsing added file:', parseError);
      setError(parseError);
    }
  }, []);

  /**
   * Handle file changed event - reparse and update in map
   */
  const handleChange = useCallback((file: VFile) => {
    try {
      console.log('File changed:', file.path);
      const parsedNode = MarkdownParser.parseMarkdownFile(file.content, file.path);

      setParsedNodesMap(prevMap => {
        const newMap = new Map(prevMap);
        newMap.set(file.path, parsedNode);
        return newMap;
      });

      setError(null);
    } catch (err) {
      const parseError = err instanceof Error ? err : new Error(`Failed to parse changed file: ${file.path}`);
      console.error('Error parsing changed file:', parseError);
      setError(parseError);
    }
  }, []);

  /**
   * Handle file deleted event - remove from map
   */
  const handleDelete = useCallback((filePath: string) => {
    console.log('File deleted:', filePath);

    setParsedNodesMap(prevMap => {
      const newMap = new Map(prevMap);
      newMap.delete(filePath);
      return newMap;
    });

    setError(null);
  }, []);

  /**
   * Handle file observer error event
   */
  const handleError = useCallback((observerError: Error) => {
    console.error('File observer error:', observerError);
    setError(observerError);
    setIsLoading(false);
  }, []);

  /**
   * Set up event listeners for file observer
   */
  const setupEventListeners = useCallback(() => {
    const observer = fileObserverRef.current;
    if (!observer) return;

    observer.on('ready', handleReady);
    observer.on('add', handleAdd);
    observer.on('change', handleChange);
    observer.on('delete', handleDelete);
    observer.on('error', handleError);
  }, [handleReady, handleAdd, handleChange, handleDelete, handleError]);

  /**
   * Clean up event listeners
   */
  const cleanupEventListeners = useCallback(() => {
    const observer = fileObserverRef.current;
    if (!observer) return;

    observer.off('ready', handleReady);
    observer.off('add', handleAdd);
    observer.off('change', handleChange);
    observer.off('delete', handleDelete);
    observer.off('error', handleError);
  }, [handleReady, handleAdd, handleChange, handleDelete, handleError]);

  /**
   * Start watching files with the given configuration
   */
  const start = useCallback(async (config: FileObserverConfig) => {
    const observer = fileObserverRef.current;
    if (!observer) {
      const initError = new Error('File observer not initialized');
      setError(initError);
      throw initError;
    }

    try {
      setIsLoading(true);
      setError(null);
      setIsInitialLoad(true); // Reset to bulk load mode for new directory

      // Clear existing data
      setParsedNodesMap(new Map());

      // Set up event listeners before starting
      setupEventListeners();

      // Start the file observer
      await observer.start(config);

      // Store the config
      setCurrentConfig(config);

      console.log('File observation started for directory:', config.watchDirectory);

    } catch (err) {
      const startError = err instanceof Error ? err : new Error('Failed to start file observation');
      console.error('Failed to start file observer:', startError);
      setError(startError);
      setIsLoading(false);
      setIsWatching(false);

      // Clean up listeners on failure
      cleanupEventListeners();

      throw startError;
    }
  }, [setupEventListeners, cleanupEventListeners]);

  /**
   * Stop watching files and clean up resources
   */
  const stop = useCallback(async () => {
    const observer = fileObserverRef.current;
    if (!observer) return;

    try {
      await observer.stop();

      // Clean up state
      cleanupEventListeners();
      setParsedNodesMap(new Map());
      setIsWatching(false);
      setIsLoading(false);
      setError(null);
      setCurrentConfig(undefined);

      console.log('File observation stopped');

    } catch (err) {
      const stopError = err instanceof Error ? err : new Error('Failed to stop file observation');
      console.error('Failed to stop file observer:', stopError);
      setError(stopError);
      throw stopError;
    }
  }, [cleanupEventListeners]);

  /**
   * Clear the current error state
   */
  const clearError = useCallback(() => {
    setError(null);
  }, []);

  /**
   * Start watching with directory chooser (for compatibility with existing components)
   */
  const startWatching = useCallback(async () => {
    // For now, we'll need to provide a default config or use Electron dialog
    // This is a compatibility method for components expecting this interface
    if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.openDirectoryDialog) {
      try {
        const result = await window.electronAPI.openDirectoryDialog();
        if (!result.canceled && result.filePaths.length > 0) {
          const selectedDirectory = result.filePaths[0];
          await start({
            watchDirectory: selectedDirectory,
            extensions: ['.md'],
            recursive: true,
            debounceMs: 100
          });
        }
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to select directory');
        setError(error);
        throw error;
      }
    } else {
      const error = new Error('Directory selection not available in this environment');
      setError(error);
      throw error;
    }
  }, [start]);

  /**
   * Stop watching (alias for the stop method)
   */
  const stopWatching = useCallback(async () => {
    await stop();
  }, [stop]);

  /**
   * Check if running in Electron environment
   */
  const isElectron = typeof window !== 'undefined' && window.electronAPI !== undefined;

  /**
   * Determine layout strategy based on loading phase
   * - Bulk load (isInitialLoad=true): Use Reingold-Tilford for efficient hierarchical layout
   * - Incremental (isInitialLoad=false): Use Seed-Park-Relax for smooth additions
   */
  const layoutStrategy: 'reingold-tilford' | 'seed-park-relax' = isInitialLoad ? 'reingold-tilford' : 'seed-park-relax';

  /**
   * Transform parsed nodes map to GraphData - memoized for efficiency
   */
  const graphData: GraphData = useMemo(() => {
    console.log('Transforming parsed nodes to graph data, node count:', parsedNodesMap.size);

    // Convert Map<string, ParsedNode> to Map<string, string> for compatibility with MarkdownParser.parseDirectory
    const filesMap = new Map<string, string>();

    for (const [filePath, parsedNode] of parsedNodesMap) {
      // Use the original content from the parsed node
      filesMap.set(filePath, parsedNode.content);
    }

    // Use the existing parseDirectory method which is synchronous and returns GraphData
    if (filesMap.size === 0) {
      return { nodes: [], edges: [] };
    }

    try {
      // Note: parseDirectory is async but we're calling it directly
      // This works because we're using the synchronous parts of the method
      const nodes: Array<{ data: { id: string; label: string; linkedNodeIds: string[] } }> = [];
      const edges: Array<{ data: { id: string; source: string; target: string } }> = [];

      // Process each parsed node to create graph data
      for (const [filePath, parsedNode] of parsedNodesMap) {
        const linkedNodeIds: string[] = [];

        // Create edges from the parsed links
        for (const link of parsedNode.links) {
          linkedNodeIds.push(link.targetFile);

          edges.push({
            data: {
              id: `${filePath}->${link.targetFile}`,
              source: filePath,
              target: link.targetFile
            }
          });
        }

        // Create node with parsed data
        nodes.push({
          data: {
            id: filePath,
            label: parsedNode.title || filePath.replace('.md', '').replace(/_/g, ' '),
            linkedNodeIds
          }
        });
      }

      return { nodes, edges };

    } catch (err) {
      console.error('Error transforming parsed nodes to graph data:', err);
      return { nodes: [], edges: [] };
    }
  }, [parsedNodesMap]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      const observer = fileObserverRef.current;
      if (observer && observer.isWatching) {
        observer.stop().catch(err => {
          console.error('Error stopping file observer on cleanup:', err);
        });
      }
    };
  }, []);

  return {
    graphData,
    isLoading,
    error,
    start,
    stop,
    isWatching,
    watchDirectory: currentConfig?.watchDirectory,
    startWatching,
    stopWatching,
    clearError,
    isElectron,
    layoutStrategy
  };
}
import type { FileObserverApi, FileObserverConfig } from './api';
import { createElectronFileObserver, isElectronEnvironment } from './implementation-electron';
import { createMockFileObserver } from './implementation-mock';
import { validateConfig, createDefaultConfig } from './utils';

/**
 * Factory function that creates the appropriate FileObserver implementation
 * based on the current environment
 */
export function createFileObserver(): FileObserverApi {
  if (isElectronEnvironment()) {
    //console.log('Creating Electron file observer');
    return createElectronFileObserver();
  } else {
    //console.log('Creating mock file observer (non-Electron environment)');
    return createMockFileObserver();
  }
}

/**
 * Singleton instance for global use
 */
let fileObserverInstance: FileObserverApi | null = null;

/**
 * Get the singleton file observer instance
 */
export function getFileObserver(): FileObserverApi {
  fileObserverInstance ??= createFileObserver();
  return fileObserverInstance;
}

/**
 * Reset the singleton instance (useful for testing)
 */
export function resetFileObserver(): void {
  if (fileObserverInstance) {
    // Clean up existing instance if it has a dispose method
    if ('dispose' in fileObserverInstance && typeof fileObserverInstance.dispose === 'function') {
      fileObserverInstance.dispose();
    }
    fileObserverInstance = null;
  }
}

/**
 * Creates a file observer with pre-validated configuration
 *
 * @param config Configuration object
 * @returns FileObserver instance configured with the provided config
 * @throws Error if configuration is invalid
 */
export function createFileObserverWithConfig(config: FileObserverConfig): FileObserverApi {
  validateConfig(config);
  const observer: FileObserverApi = createFileObserver();

  // Pre-configure the observer (this is a convenience method)
  observer.start(config).catch(error => {
    console.error('Failed to start file observer with provided config:', error);
  });

  return observer;
}

/**
 * Creates a file observer with default configuration for a directory
 *
 * @param watchDirectory Directory to watch
 * @param overrides Optional configuration overrides
 * @returns FileObserver instance with default configuration
 */
export function createFileObserverForDirectory(
  watchDirectory: string,
  overrides?: Partial<FileObserverConfig>
): FileObserverApi {
  const config: FileObserverConfig = createDefaultConfig(watchDirectory, overrides);
  return createFileObserverWithConfig(config);
}

/**
 * Environment information for debugging
 */
export function getEnvironmentInfo(): {
  isElectron: boolean;
  implementationType: 'electron' | 'mock';
  hasElectronAPI: boolean;
  userAgent?: string;
} {
  const isElectron: boolean = isElectronEnvironment();
  const hasElectronAPI: boolean = typeof window !== 'undefined' && !!(window as typeof window & { electronAPI?: unknown }).electronAPI;

  return {
    isElectron,
    implementationType: isElectron ? 'electron' : 'mock',
    hasElectronAPI,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined
  };
}
// Export types and interfaces from the API
export type {
  FileObserverApi,
  FileObserverConfig,
  FileObserverEventName,
  FileObserverEventCallback,
  FileObserverEventCallbacks,
  VFile,
  FileObserverErrorCode,
  ExtractEventData
} from './api';

export { FileObserverError } from './api';

// Export Electron implementation
export {
  ElectronFileObserver,
  createElectronFileObserver,
  isElectronEnvironment
} from './implementation-electron';

// Export Mock implementation
export {
  MockFileObserver,
  createMockFileObserver
} from './implementation-mock';

// Export factory functions
export {
  createFileObserver,
  getFileObserver,
  resetFileObserver,
  createFileObserverWithConfig,
  createFileObserverForDirectory,
  getEnvironmentInfo
} from './factory';

// Export utility functions
export * from './utils';

// Export test utilities (for testing environments)
export * from './test-utils';
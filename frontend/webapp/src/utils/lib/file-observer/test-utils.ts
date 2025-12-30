/**
 * Test utilities for the FileObserver API
 *
 * This module provides helper functions and utilities for testing file observer
 * implementations, including mock data generators and test markdown_parsing.
 */

import type { VFile, FileObserverConfig } from './api';
import { FileObserverErrorCode } from './api';
import { MockFileObserver } from './implementation-mock';

/**
 * Creates a mock VFile object for testing
 *
 * @param path File absolutePath
 * @param content File content
 * @param lastModified Optional timestamp
 * @returns Mock VFile object
 */
export function createMockFile(
  path: string,
  content: string = `# Test File\n\nThis is a test file at ${path}`,
  lastModified: number = Date.now()
): VFile {
  return {
    path,
    content,
    lastModified
  };
}

/**
 * Creates multiple mock files for testing
 *
 * @param basePath Base directory absolutePath
 * @param count Number of files to create
 * @param extension File extension (default: '.md')
 * @returns Array of mock VFile objects
 */
export function createMockFiles(
  basePath: string,
  count: number,
  extension: string = '.md'
): VFile[] {
  const files: VFile[] = [];

  for (let i: number = 1; i <= count; i++) {
    const path: string = `${basePath}/test-file-${i}${extension}`;
    const content: string = `# Test File ${i}\n\nContent for test file number ${i}.\n\nCreated at: ${new Date().toISOString()}`;
    files.push(createMockFile(path, content));
  }

  return files;
}

/**
 * Creates a test configuration with default values
 *
 * @param overrides Configuration overrides
 * @returns Test configuration
 */
export function createTestConfig(overrides?: Partial<FileObserverConfig>): FileObserverConfig {
  return {
    watchDirectory: '/test/directory',
    extensions: ['.md', '.txt'],
    recursive: true,
    debounceMs: 50, // Faster for e2e-tests
    ...overrides
  };
}

/**
 * Creates a mock file observer with pre-configured test settings
 *
 * @param config Optional configuration
 * @returns MockFileObserver instance configured for testing
 */
export function createTestFileObserver(): MockFileObserver {
  const observer: MockFileObserver = new MockFileObserver();

  // Override some mock behaviors for more predictable testing
  const originalStart: (config: FileObserverConfig) => Promise<void> = observer.start.bind(observer);
  observer.start = async (cfg: FileObserverConfig) => {
    const testConfig: { watchDirectory: string; extensions?: string[]; recursive?: boolean; debounceMs?: number; } = { ...createTestConfig(), ...cfg };
    return originalStart(testConfig);
  };

  return observer;
}

/**
 * Waits for a file observer event with timeout
 *
 * @param observer File observer instance
 * @param eventName Event to wait for
 * @param timeout Timeout in milliseconds (default: 5000)
 * @returns Promise that resolves with the event data
 */
export function waitForEvent<T>(
  observer: { on: (event: string, handler: (data: T) => void) => void; off: (event: string, handler: (data: T) => void) => void },
  eventName: string,
  timeout: number = 5000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId: NodeJS.Timeout = setTimeout(() => {
      observer.off(eventName, handler);
      reject(new Error(`Timeout waiting for ${eventName} event`));
    }, timeout);

    const handler: (data: T) => void = (data: T) => {
      clearTimeout(timeoutId);
      observer.off(eventName, handler);
      resolve(data);
    };

    observer.on(eventName, handler);
  });
}

/**
 * Collects multiple events from a file observer
 *
 * @param observer File observer instance
 * @param eventName Event to collect
 * @param count Number of events to collect
 * @param timeout Total timeout in milliseconds
 * @returns Promise that resolves with array of event data
 */
export function collectEvents<T>(
  observer: { on: (event: string, handler: (data: T) => void) => void; off: (event: string, handler: (data: T) => void) => void },
  eventName: string,
  count: number,
  timeout: number = 10000
): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const events: T[] = [];
    const timeoutId: NodeJS.Timeout = setTimeout(() => {
      observer.off(eventName, handler);
      reject(new Error(`Timeout: only collected ${events.length}/${count} ${eventName} events`));
    }, timeout);

    const handler: (data: T) => void = (data: T) => {
      events.push(data);
      if (events.length >= count) {
        clearTimeout(timeoutId);
        observer.off(eventName, handler);
        resolve(events);
      }
    };

    observer.on(eventName, handler);
  });
}

/**
 * Creates a test scenario with predictable file events
 *
 * @param observer MockFileObserver instance
 * @param scenario Array of events to trigger
 * @returns Promise that resolves when all events are triggered
 */
export async function runTestScenario(
  observer: MockFileObserver,
  scenario: Array<{
    type: 'add' | 'change' | 'delete' | 'error';
    data: VFile | string | { message: string; code: FileObserverErrorCode };
    delay?: number;
  }>
): Promise<void> {
  for (const event of scenario) {
    if (event.delay) {
      await new Promise(resolve => setTimeout(resolve, event.delay));
    }

    switch (event.type) {
      case 'add':
        observer.triggerFileAdd(event.data as VFile);
        break;
      case 'change':
        observer.triggerFileChange(event.data as VFile);
        break;
      case 'delete':
        observer.triggerFileDelete(event.data as string);
        break;
      case 'error':
        observer.triggerError((event.data as { message: string; code: FileObserverErrorCode }).message, (event.data as { message: string; code: FileObserverErrorCode }).code);
        break;
    }
  }
}

/**
 * Creates markdown content with specific patterns for testing
 *
 * @param title Document title
 * @param headingCount Number of headings to include
 * @param withLinks Whether to include links
 * @returns Generated markdown content
 */
export function generateMarkdownContent(
  title: string,
  headingCount: number = 3,
  withLinks: boolean = false
): string {
  let content: string = `# ${title}\n\n`;

  content += `This is a test document created at ${new Date().toISOString()}.\n\n`;

  for (let i: number = 1; i <= headingCount; i++) {
    content += `## Section ${i}\n\n`;
    content += `This is the content for section ${i}. `;

    if (withLinks) {
      content += `See also [Related Topic ${i}](./related-${i}.md). `;
    }

    content += `\n\n`;

    // Add some list items
    content += `- Item ${i}.1\n`;
    content += `- Item ${i}.2\n`;
    content += `- Item ${i}.3\n\n`;
  }

  content += `## Conclusion\n\n`;
  content += `This document was generated for testing purposes.\n`;

  return content;
}

/**
 * Validates that a VFile has expected properties
 *
 * @param file VFile to validate
 * @param expectations Expected properties
 * @throws Error if validation fails
 */
export function validateFile(
  file: VFile,
  expectations: {
    path?: string | RegExp;
    contentLength?: { min?: number; max?: number };
    hasContent?: string | RegExp;
    lastModified?: { after?: number; before?: number };
  }
): void {
  if (expectations.path) {
    if (typeof expectations.path === 'string') {
      if (file.path !== expectations.path) {
        throw new Error(`Expected path ${expectations.path}, got ${file.path}`);
      }
    } else {
      if (!expectations.path.test(file.path)) {
        throw new Error(`Path ${file.path} does not match pattern ${expectations.path}`);
      }
    }
  }

  if (expectations.contentLength) {
    const length: number = file.content.length;
    if (expectations.contentLength.min !== undefined && length < expectations.contentLength.min) {
      throw new Error(`Content too short: ${length} < ${expectations.contentLength.min}`);
    }
    if (expectations.contentLength.max !== undefined && length > expectations.contentLength.max) {
      throw new Error(`Content too long: ${length} > ${expectations.contentLength.max}`);
    }
  }

  if (expectations.hasContent) {
    if (typeof expectations.hasContent === 'string') {
      if (!file.content.includes(expectations.hasContent)) {
        throw new Error(`Content does not include "${expectations.hasContent}"`);
      }
    } else {
      if (!expectations.hasContent.test(file.content)) {
        throw new Error(`Content does not match pattern ${expectations.hasContent}`);
      }
    }
  }

  if (expectations.lastModified && file.lastModified) {
    if (expectations.lastModified.after !== undefined &&
        file.lastModified <= expectations.lastModified.after) {
      throw new Error(`LastModified too old: ${file.lastModified} <= ${expectations.lastModified.after}`);
    }
    if (expectations.lastModified.before !== undefined &&
        file.lastModified >= expectations.lastModified.before) {
      throw new Error(`LastModified too new: ${file.lastModified} >= ${expectations.lastModified.before}`);
    }
  }
}

/**
 * Creates a test environment with temporary directories and files
 * Note: This is a mock implementation for testing - doesn't create real files
 *
 * @param config Test environment configuration
 * @returns Test environment utilities
 */
export function createTestEnvironment(config: {
  baseDirectory: string;
  files?: Array<{ path: string; content?: string }>;
}): {
  getFile: (path: string) => VFile | undefined;
  addFile: (path: string, content?: string) => VFile;
  listFiles: () => VFile[];
  removeFile: (path: string) => boolean;
  clear: () => void;
  getBaseDirectory: () => string;
} {
  const files: Map<string, VFile> = new Map<string, VFile>();

  // Initialize with provided files
  config.files?.forEach(file => {
    const fullPath: string = `${config.baseDirectory}/${file.path}`;
    files.set(fullPath, createMockFile(fullPath, file.content));
  });

  return {
    /**
     * Add a file to the test environment
     */
    addFile(path: string, content?: string): VFile {
      const fullPath: string = `${config.baseDirectory}/${path}`;
      const file: VFile = createMockFile(fullPath, content);
      files.set(fullPath, file);
      return file;
    },

    /**
     * Get a file from the test environment
     */
    getFile(path: string): VFile | undefined {
      const fullPath: string = `${config.baseDirectory}/${path}`;
      return files.get(fullPath);
    },

    /**
     * List all files in the test environment
     */
    listFiles(): VFile[] {
      return Array.from(files.values());
    },

    /**
     * Remove a file from the test environment
     */
    removeFile(path: string): boolean {
      const fullPath: string = `${config.baseDirectory}/${path}`;
      return files.delete(fullPath);
    },

    /**
     * Clear all files from the test environment
     */
    clear(): void {
      files.clear();
    },

    /**
     * Get the base directory
     */
    getBaseDirectory(): string {
      return config.baseDirectory;
    }
  };
}
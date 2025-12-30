/**
 * Utility functions for the FileObserver API
 *
 * This module provides helper functions for common file observer operations,
 * configuration validation, and utility functions for consumers.
 */

import type { FileObserverConfig, VFile } from './api';
import { FileObserverError, FileObserverErrorCode } from './api';

/**
 * Validates a FileObserver configuration object
 *
 * @param config Configuration to validate
 * @throws FileObserverError if configuration is invalid
 */
export function validateConfig(config: FileObserverConfig): void {
  if (!config.watchDirectory) {
    throw new FileObserverError(
      'Watch directory is required',
      FileObserverErrorCode.INVALID_CONFIG
    );
  }

  if (config.watchDirectory.trim().length === 0) {
    throw new FileObserverError(
      'Watch directory cannot be empty',
      FileObserverErrorCode.INVALID_CONFIG
    );
  }

  if (config.extensions && config.extensions.length === 0) {
    throw new FileObserverError(
      'Extensions array cannot be empty if provided',
      FileObserverErrorCode.INVALID_CONFIG
    );
  }

  if (config.extensions) {
    const invalidExtensions: string[] = config.extensions.filter(ext => !ext.startsWith('.'));
    if (invalidExtensions.length > 0) {
      throw new FileObserverError(
        `Extensions must start with a dot: ${invalidExtensions.join(', ')}`,
        FileObserverErrorCode.INVALID_CONFIG
      );
    }
  }

  if (config.debounceMs !== undefined && config.debounceMs < 0) {
    throw new FileObserverError(
      'Debounce delay cannot be negative',
      FileObserverErrorCode.INVALID_CONFIG
    );
  }
}

/**
 * Creates a default configuration with sensible defaults
 *
 * @param watchDirectory Directory to watch
 * @param overrides Optional configuration overrides
 * @returns Complete configuration with defaults applied
 */
export function createDefaultConfig(
  watchDirectory: string,
  overrides?: Partial<FileObserverConfig>
): FileObserverConfig {
  const config: FileObserverConfig = {
    watchDirectory,
    extensions: ['.md'],
    recursive: true,
    debounceMs: 100,
    ...overrides
  };

  validateConfig(config);
  return config;
}

/**
 * Checks if a file matches the configured extensions
 *
 * @param filePath Path to the file
 * @param extensions Array of extensions to match (e.g., ['.md', '.txt'])
 * @returns True if file matches any extension, false otherwise
 */
export function matchesExtensions(filePath: string, extensions?: string[]): boolean {
  if (!extensions || extensions.length === 0) {
    return true; // If no extensions specified, match all files
  }

  const fileExtension: string = getFileExtension(filePath);
  return extensions.includes(fileExtension);
}

/**
 * Extracts the file extension from a file absolutePath
 *
 * @param filePath Path to the file
 * @returns File extension including the dot (e.g., '.md')
 */
export function getFileExtension(filePath: string): string {
  const lastDotIndex: number = filePath.lastIndexOf('.');
  if (lastDotIndex === -1 || lastDotIndex === filePath.length - 1) {
    return '';
  }
  return filePath.substring(lastDotIndex);
}

/**
 * Extracts the filename from a file absolutePath
 *
 * @param filePath Path to the file
 * @returns Filename without directory absolutePath
 */
export function getFileName(filePath: string): string {
  const lastSlashIndex: number = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return filePath.substring(lastSlashIndex + 1);
}

/**
 * Extracts the directory from a file absolutePath
 *
 * @param filePath Path to the file
 * @returns Directory absolutePath without filename
 */
export function getDirectory(filePath: string): string {
  const lastSlashIndex: number = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastSlashIndex === -1) {
    return '';
  }
  return filePath.substring(0, lastSlashIndex);
}

/**
 * Checks if a file absolutePath is within a directory (including subdirectories)
 *
 * @param filePath Path to check
 * @param directory Directory to check against
 * @returns True if file is within directory
 */
export function isFileInDirectory(filePath: string, directory: string): boolean {
  const normalizedFilePath: string = normalizePath(filePath);
  const normalizedDirectory: string = normalizePath(directory);

  return normalizedFilePath.startsWith(normalizedDirectory + '/') ||
         normalizedFilePath === normalizedDirectory;
}

/**
 * Normalizes a file absolutePath by removing trailing slashes and converting to lowercase
 *
 * @param path Path to normalize
 * @returns Normalized absolutePath
 */
export function normalizePath(path: string): string {
  return path.replace(/\/+$/, '').toLowerCase();
}

/**
 * Creates a debounced version of a function
 *
 * @param func Function to debounce
 * @param delayMs Delay in milliseconds
 * @returns Debounced function
 */
export function debounce<T extends (...args: unknown[]) => void>(
  func: T,
  delayMs: number
): T {
  let timeoutId: NodeJS.Timeout | null = null;

  return ((...args: unknown[]) => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, delayMs);
  }) as T;
}

/**
 * Creates a throttled version of a function
 *
 * @param func Function to throttle
 * @param delayMs Minimum delay between calls in milliseconds
 * @returns Throttled function
 */
export function throttle<T extends (...args: unknown[]) => void>(
  func: T,
  delayMs: number
): T {
  let lastCallTime: number = 0;
  let timeoutId: NodeJS.Timeout | null = null;

  return ((...args: unknown[]) => {
    const now: number = Date.now();

    if (now - lastCallTime >= delayMs) {
      lastCallTime = now;
      func(...args);
    } else {
      timeoutId ??= setTimeout(() => {
        lastCallTime = Date.now();
        func(...args);
        timeoutId = null;
      }, delayMs - (now - lastCallTime));
    }
  }) as T;
}

/**
 * Formats file size in human-readable format
 *
 * @param bytes File size in bytes
 * @returns Formatted string (e.g., "1.5 KB", "2.3 MB")
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';

  const k: number = 1024;
  const sizes: string[] = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i: number = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Gets file size from VFile content
 *
 * @param file VFile object
 * @returns File size in bytes
 */
export function getFileSize(file: VFile): number {
  return new Blob([file.content]).size;
}

/**
 * Extracts markdown headings from file content
 *
 * @param content Markdown content
 * @returns Array of heading objects with level and text
 */
export function extractMarkdownHeadings(content: string): Array<{ level: number; text: string }> {
  const headingRegex: RegExp = /^(#{1,6})\s+(.+)$/gm;
  const headings: Array<{ level: number; text: string }> = [];

  let match: RegExpExecArray | null;
  while ((match = headingRegex.exec(content)) !== null) {
    headings.push({
      level: match[1].length,
      text: match[2].trim()
    });
  }

  return headings;
}

/**
 * Sanitizes file content for safe display (removes potentially dangerous content)
 *
 * @param content File content to sanitize
 * @param maxLength Maximum length to truncate to
 * @returns Sanitized content
 */
export function sanitizeContent(content: string, maxLength: number = 10000): string {
  // Remove potential script tags and other dangerous content
  let sanitized: string = content
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '[SCRIPT REMOVED]')
    .replace(/<iframe[^>]*>[\s\S]*?<\/iframe>/gi, '[IFRAME REMOVED]')
    .replace(/javascript:/gi, '[JAVASCRIPT REMOVED]');

  // Truncate if too long
  if (sanitized.length > maxLength) {
    sanitized = sanitized.substring(0, maxLength) + '...';
  }

  return sanitized;
}

/**
 * Creates a safe preview of file content
 *
 * @param file VFile to create preview for
 * @param maxLines Maximum number of lines to include
 * @returns Preview string
 */
export function createFilePreview(file: VFile, maxLines: number = 10): string {
  const lines: string[] = file.content.split('\n');
  const previewLines: string[] = lines.slice(0, maxLines);

  let preview: string = previewLines.join('\n');

  if (lines.length > maxLines) {
    preview += `\n... (${lines.length - maxLines} more lines)`;
  }

  return sanitizeContent(preview);
}
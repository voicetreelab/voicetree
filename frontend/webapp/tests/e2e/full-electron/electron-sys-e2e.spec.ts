/**
 * DEPRECATED: This file has been split into:
 * - electron-file-watching-e2e.spec.ts (core file watching tests)
 * - electron-features-e2e.spec.ts (UI feature tests)
 *
 * This file is kept for backward compatibility but will be removed in the future.
 * Please update your test commands to run the new split files.
 */

// Re-export tests from the split files
export * from './electron-file-watching-e2e.spec';
export * from './electron-features-e2e.spec';

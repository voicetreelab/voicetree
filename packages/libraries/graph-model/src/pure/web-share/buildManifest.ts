import type { RelativePath, ShareManifest } from './types'

/**
 * Build a ShareManifest from validated paths.
 * Filters to .md paths only. No nodeCount - callers use manifest.files.length.
 */
export function buildManifest(
  paths: readonly RelativePath[],
  folderName: string,
  createdAt?: string
): ShareManifest {
  return {
    files: paths.filter(p => p.endsWith('.md')),
    folderName,
    createdAt: createdAt ?? new Date().toISOString()
  }
}

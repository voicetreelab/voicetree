// Daemon-level slot for the active folder-tree read model.
//
// `startDaemon` installs an instance (production: wraps `getDirectoryTree`;
// tests: a counting/failing scanner) and consumers (sessionState workflow,
// watcher event handler, project lifecycle) read it from here. Reset on daemon
// stop so tests do not leak cache state across workers.

import type { DirectoryEntry } from '@vt/graph-model/folders'
import { getDirectoryTree } from '@vt/graph-db-server/graph/folderScanner'
import { createFolderTreeReadModel } from '../data/folder-tree-cache/folderTreeReadModel.ts'
import type {
  FolderTreeReadModel,
  FolderTreeScanner,
} from '../data/folder-tree-cache/types.ts'

let current: FolderTreeReadModel | null = null

const defaultScanner: FolderTreeScanner = async (root, maxDepth) => {
  try {
    return (await getDirectoryTree(root, maxDepth)) as DirectoryEntry
  } catch {
    // Treat a missing or unreadable root as a cacheable `null` — callers fall
    // back to an empty folderTree. The cache will be cleared by the next
    // structural event (chokidar add, project close, etc.).
    return null
  }
}

export function installFolderTreeReadModel(
  scanner: FolderTreeScanner = defaultScanner,
): FolderTreeReadModel {
  current = createFolderTreeReadModel(scanner)
  return current
}

// Auto-installs with the default scanner on first access so callers (e.g.
// `broadcast-folder-tree`) work in non-daemon test contexts. `startDaemon`
// still calls `installFolderTreeReadModel(opts.folderTreeScanner)` BEFORE any
// consumer reads, so the explicit test-injection seam is preserved.
export function getFolderTreeReadModel(): FolderTreeReadModel {
  if (!current) {
    current = createFolderTreeReadModel(defaultScanner)
  }
  return current
}

export function resetFolderTreeReadModel(): void {
  current = null
}

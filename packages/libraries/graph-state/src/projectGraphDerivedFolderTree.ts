// BF-336 · Pure graph-derived folder projection.
//
// Synthesizes a `FolderTreeNode` for projected-graph / live-state reads
// WITHOUT touching the filesystem. The folder structure is derived purely
// from:
//   - the in-memory graph (node keys are absolute file paths),
//   - the active read paths, project paths, and write path,
//   - the project root that anchors the synthesized tree.
//
// The downstream consumer (`projectSessionState`) expects a `FolderTreeNode`
// whose `absolutePath` is the tree root. We therefore reuse the existing pure
// transform `buildFolderTree(...)` by synthesising a `DirectoryEntry` tree
// that contains exactly the folders relevant to projection:
//   - the chosen root (projectRoot),
//   - every ancestor folder of every graph-node file path under the root,
//   - every read/project/write path that is at or under the root (even if it
//     currently contains no graph nodes),
// and the graph-node files themselves as leaf entries.
//
// All inputs are immutable values; no I/O is performed. Calling this function
// in an environment where `fs` operations throw is structurally safe because
// the function makes no `fs.*` calls at all.

import { buildFolderTree, toAbsolutePath } from '@vt/graph-model'
import type {
  AbsolutePath,
  DirectoryEntry,
  FolderTreeNode,
  Graph,
} from '@vt/graph-model'

export interface ProjectGraphDerivedFolderTreeArgs {
  readonly graph: Graph
  readonly projectRoot: string | null
  readonly readPaths: readonly string[]
  readonly projectPaths: readonly string[]
  readonly writeFolderPath: string | null
}

function normalizeFolderPath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

function basename(path: string): string {
  const normalized = normalizeFolderPath(path)
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash < 0) return normalized
  return normalized.slice(lastSlash + 1)
}

function parentDirectoryPath(path: string): string | null {
  const normalized = normalizeFolderPath(path)
  if (normalized === '' || normalized === '/') return null
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return null
  return normalized.slice(0, lastSlash)
}

function isAtOrUnder(candidate: string, root: string): boolean {
  const normalizedCandidate = normalizeFolderPath(candidate)
  const normalizedRoot = normalizeFolderPath(root)
  if (normalizedCandidate === normalizedRoot) return true
  return normalizedCandidate.startsWith(normalizedRoot + '/')
}

function collectAncestorFoldersOfFile(
  filePath: string,
  root: string,
  out: Set<string>,
): void {
  // Walk up from the file's parent directory until we reach (but do not pass) the root.
  let current = parentDirectoryPath(filePath)
  const normalizedRoot = normalizeFolderPath(root)
  while (current && current !== normalizedRoot) {
    if (out.has(current)) return
    out.add(current)
    current = parentDirectoryPath(current)
  }
}

function collectFolderAndAncestors(
  folderPath: string,
  root: string,
  out: Set<string>,
): void {
  // Add the folder itself plus every ancestor up to (but not past) the root.
  const normalizedRoot = normalizeFolderPath(root)
  let current: string | null = normalizeFolderPath(folderPath)
  while (current && current !== normalizedRoot) {
    if (out.has(current)) return
    out.add(current)
    current = parentDirectoryPath(current)
  }
}

interface MutableDirectory {
  readonly absolutePath: AbsolutePath
  readonly name: string
  readonly childFolders: Map<string, MutableDirectory>
  readonly childFiles: Map<string, { readonly absolutePath: AbsolutePath; readonly name: string }>
}

function makeMutableDirectory(absolutePath: string): MutableDirectory {
  return {
    absolutePath: toAbsolutePath(normalizeFolderPath(absolutePath)),
    name: basename(absolutePath),
    childFolders: new Map(),
    childFiles: new Map(),
  }
}

function ensureFolderChain(
  root: MutableDirectory,
  rootPath: string,
  folderPath: string,
): MutableDirectory {
  // Walks from the root down to `folderPath`, creating intermediate
  // MutableDirectory entries on demand.
  const normalizedRoot = normalizeFolderPath(rootPath)
  const normalizedTarget = normalizeFolderPath(folderPath)
  if (normalizedTarget === normalizedRoot) return root

  const suffix = normalizedTarget.slice(normalizedRoot.length + 1)
  const segments = suffix.length === 0 ? [] : suffix.split('/')

  let cursor = root
  let cursorPath = normalizedRoot
  for (const segment of segments) {
    cursorPath = cursorPath === '/' ? `/${segment}` : `${cursorPath}/${segment}`
    const existing = cursor.childFolders.get(segment)
    if (existing) {
      cursor = existing
      continue
    }
    const created = makeMutableDirectory(cursorPath)
    cursor.childFolders.set(segment, created)
    cursor = created
  }
  return cursor
}

function freezeMutableToDirectoryEntry(node: MutableDirectory): DirectoryEntry {
  const children: DirectoryEntry[] = []
  for (const folder of node.childFolders.values()) {
    children.push(freezeMutableToDirectoryEntry(folder))
  }
  for (const file of node.childFiles.values()) {
    children.push({
      absolutePath: file.absolutePath,
      name: file.name,
      isDirectory: false,
    })
  }
  return {
    absolutePath: node.absolutePath,
    name: node.name,
    isDirectory: true,
    children,
  }
}

/**
 * Project a folder tree from the in-memory graph and active root
 * configuration. Pure: no filesystem access.
 *
 * Returns null when there is no anchoring project root.
 */
export function projectGraphDerivedFolderTree(
  args: ProjectGraphDerivedFolderTreeArgs,
): FolderTreeNode | null {
  const { graph, projectRoot, readPaths, projectPaths, writeFolderPath } = args
  if (!projectRoot) return null

  const rootPath = normalizeFolderPath(projectRoot)

  // 1. Determine the set of folders that must appear in the synthesized tree:
  //    - the root itself
  //    - every read/project/write path at-or-under the root
  //    - every ancestor folder of every graph node file at-or-under the root
  const requiredFolderPaths = new Set<string>([rootPath])

  const candidateRoots: readonly string[] = [
    ...readPaths,
    ...projectPaths,
    ...(writeFolderPath ? [writeFolderPath] : []),
  ]
  for (const candidate of candidateRoots) {
    if (!candidate) continue
    if (!isAtOrUnder(candidate, rootPath)) continue
    // Include the candidate folder itself plus its ancestor chain up to root.
    collectFolderAndAncestors(candidate, rootPath, requiredFolderPaths)
  }

  const graphFilePaths = Object.keys(graph.nodes)
  for (const filePath of graphFilePaths) {
    if (!isAtOrUnder(filePath, rootPath)) continue
    collectAncestorFoldersOfFile(filePath, rootPath, requiredFolderPaths)
  }

  // 2. Synthesize the mutable directory tree.
  const rootDir = makeMutableDirectory(rootPath)
  for (const folderPath of requiredFolderPaths) {
    if (folderPath === rootPath) continue
    ensureFolderChain(rootDir, rootPath, folderPath)
  }

  // 3. Attach graph-node files as leaf entries under their parent folder.
  for (const filePath of graphFilePaths) {
    if (!isAtOrUnder(filePath, rootPath)) continue
    const parent = parentDirectoryPath(filePath)
    if (!parent) continue
    const parentDir = ensureFolderChain(rootDir, rootPath, parent)
    if (parentDir.childFiles.has(filePath)) continue
    parentDir.childFiles.set(filePath, {
      absolutePath: toAbsolutePath(filePath),
      name: basename(filePath),
    })
  }

  // 4. Freeze the synthesized structure into a DirectoryEntry tree and hand
  //    it to the pure buildFolderTree transform so downstream sees exactly
  //    the same FolderTreeNode shape (sorting, loadState, isWriteTarget,
  //    isInGraph) as a scanned tree.
  const directoryEntry = freezeMutableToDirectoryEntry(rootDir)
  const loadedPaths = new Set<string>([...readPaths, ...projectPaths])
  const graphFilePathsSet = new Set<string>(graphFilePaths)

  return buildFolderTree(
    directoryEntry,
    loadedPaths,
    writeFolderPath ? toAbsolutePath(writeFolderPath) : null,
    graphFilePathsSet,
  )
}

import { buildFolderTree, getExternalReadPaths, toAbsolutePath, type AbsolutePath, type DirectoryEntry, type FolderTreeNode, type Graph } from '@vt/graph-model'
import type { ProjectState } from '@vt/graph-db-client'
import { getDirectoryTree } from '@/shell/edge/main/graph/watch_folder/folderScanning'
import { getStarredFolders } from '@/shell/edge/main/graph/watch_folder/starredFolders'

export type FolderTreeSyncPayload = {
  externalTrees: Record<string, FolderTreeNode>
  rootTree: FolderTreeNode | null
  starredFolders: readonly string[]
  starredTrees: Record<string, FolderTreeNode>
}

export async function buildFolderTreeSyncPayload(
  projectState: ProjectState,
  graph: Graph,
): Promise<FolderTreeSyncPayload> {
  const loadedPaths: Set<string> = new Set<string>([
    ...projectState.readPaths,
    projectState.writeFolderPath,
  ])
  const writeFolderPath: AbsolutePath = toAbsolutePath(projectState.writeFolderPath)
  const graphFilePaths: Set<string> = new Set<string>(Object.keys(graph.nodes))

  // Each folder scan is an independent recursive `fs.readdir`. Build the
  // tree for one folder, returning null on any unreadable folder so a single
  // failure never rejects the whole batch (matches the prior per-folder
  // try/catch). `maxDepth` omitted => getDirectoryTree's default for the root.
  const buildTreeFor = async (
    folder: string,
    maxDepth?: number,
  ): Promise<FolderTreeNode | null> => {
    try {
      const entry: DirectoryEntry = maxDepth === undefined
        ? await getDirectoryTree(folder)
        : await getDirectoryTree(folder, maxDepth)
      return buildFolderTree(entry, loadedPaths, writeFolderPath, graphFilePaths)
    } catch {
      return null
    }
  }

  const starredFolders: readonly string[] = await getStarredFolders()
  const externalFolders: readonly string[] = getExternalReadPaths(
    projectState.readPaths,
    projectState.projectRoot,
  )

  // Root, starred and external scans are mutually independent — run them
  // concurrently so total latency is the slowest scan, not their sum.
  const [rootTree, starredTreeList, externalTreeList]: [
    FolderTreeNode | null,
    readonly (FolderTreeNode | null)[],
    readonly (FolderTreeNode | null)[],
  ] = await Promise.all([
    buildTreeFor(projectState.projectRoot),
    Promise.all(starredFolders.map((folder) => buildTreeFor(folder, 3))),
    Promise.all(externalFolders.map((folder) => buildTreeFor(folder, 3))),
  ])

  const starredTrees: Record<string, FolderTreeNode> = {}
  starredFolders.forEach((folder, index) => {
    const tree: FolderTreeNode | null = starredTreeList[index]
    if (tree !== null) starredTrees[folder] = tree
  })

  const externalTrees: Record<string, FolderTreeNode> = {}
  externalFolders.forEach((folder, index) => {
    const tree: FolderTreeNode | null = externalTreeList[index]
    if (tree !== null) externalTrees[folder] = tree
  })

  return { externalTrees, rootTree, starredFolders, starredTrees }
}

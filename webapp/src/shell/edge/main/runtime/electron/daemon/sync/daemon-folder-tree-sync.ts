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

  let rootTree: FolderTreeNode | null = null
  try {
    const rootEntry: DirectoryEntry = await getDirectoryTree(projectState.projectRoot)
    rootTree = buildFolderTree(rootEntry, loadedPaths, writeFolderPath, graphFilePaths)
  } catch {
    rootTree = null
  }

  const starredFolders: readonly string[] = await getStarredFolders()

  const starredTrees: Record<string, FolderTreeNode> = {}
  for (const folder of starredFolders) {
    try {
      const entry: DirectoryEntry = await getDirectoryTree(folder, 3)
      starredTrees[folder] = buildFolderTree(
        entry,
        loadedPaths,
        writeFolderPath,
        graphFilePaths,
      )
    } catch {
      // Ignore unreadable starred folders; this matches the existing push path.
    }
  }

  const externalTrees: Record<string, FolderTreeNode> = {}
  for (const folder of getExternalReadPaths(projectState.readPaths, projectState.projectRoot)) {
    try {
      const entry: DirectoryEntry = await getDirectoryTree(folder, 3)
      externalTrees[folder] = buildFolderTree(
        entry,
        loadedPaths,
        writeFolderPath,
        graphFilePaths,
      )
    } catch {
      // Ignore unreadable external trees; this matches the existing push path.
    }
  }

  return { externalTrees, rootTree, starredFolders, starredTrees }
}

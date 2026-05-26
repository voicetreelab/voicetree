// BF-214 · pure session-state projection.
// Assembles a @vt/graph-state State from the daemon's ambient sources
// (graph, vault, folder-tree) overlaid with a session's view state
// (collapseSet, selection, layout viewport). This is the same shape today's
// webapp/main `buildLiveStateSnapshot` emits — UI + CLI share this function in P7.
import { collectLayoutPositions } from '@vt/graph-state'
import type { State } from '@vt/graph-state'
import type { FolderTreeNode, Graph, GraphNode } from '@vt/graph-model'
import type { VaultState } from '@vt/graph-db-server/contract'
import type { Session } from './types.ts'

type FolderState = 'expanded' | 'collapsed' | 'hidden'
type FileTreeNode = FolderTreeNode['children'][number] extends infer Child
  ? Child extends { readonly isInGraph: boolean }
    ? Child
    : never
  : never

type FolderRecord = {
  readonly node: FolderTreeNode
  readonly path: string
  readonly parentPath: string | null
  readonly childFolderPaths: readonly string[]
  readonly directFiles: readonly FileTreeNode[]
}

interface ProjectSessionStateArgs {
  readonly graph: Graph
  readonly vault: VaultState
  readonly folderTree: FolderTreeNode | null
  readonly session: Session
}

function normalizeFolderPath(path: string): string {
  return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
}

function parentFolderPath(path: string): string | null {
  const normalized = normalizeFolderPath(path)
  if (normalized === '' || normalized === '/') return null
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash <= 0) return null
  return normalized.slice(0, lastSlash)
}

function parentFolderPathForFile(path: string): string | null {
  const lastSlash = path.lastIndexOf('/')
  if (lastSlash <= 0) return null
  return path.slice(0, lastSlash)
}

function folderId(path: string): string {
  return `${normalizeFolderPath(path)}/`
}

function ownFolderState(
  folderState: ReadonlyMap<string, FolderState>,
  path: string,
): FolderState {
  return folderState.get(normalizeFolderPath(path)) ?? 'hidden'
}

function explicitFolderState(
  folderState: ReadonlyMap<string, FolderState>,
  path: string,
): FolderState | undefined {
  return folderState.get(normalizeFolderPath(path))
}

function folderStateWithImplicitWriteFolder(
  folderState: ReadonlyMap<string, FolderState>,
  writeFolder: string,
): ReadonlyMap<string, FolderState> {
  const normalizedWriteFolder = normalizeFolderPath(writeFolder)
  if (normalizedWriteFolder.length === 0 || folderState.has(normalizedWriteFolder)) return folderState
  return new Map([...folderState, [normalizedWriteFolder, 'expanded' as const]])
}

function nearestExplicitAncestorState(
  folderState: ReadonlyMap<string, FolderState>,
  path: string,
): FolderState | undefined {
  let current: string | null = parentFolderPath(path)
  while (current) {
    const state = explicitFolderState(folderState, current)
    if (state) return state
    current = parentFolderPath(current)
  }
  return undefined
}

function isFolderRendered(
  folderState: ReadonlyMap<string, FolderState>,
  path: string,
): boolean {
  const state = explicitFolderState(folderState, path)
  if (state) return state !== 'hidden'
  return nearestExplicitAncestorState(folderState, path) === 'expanded'
}

function collectFolderRecords(
  node: FolderTreeNode,
  parentPath: string | null,
  out: Map<string, FolderRecord>,
): void {
  const path = normalizeFolderPath(node.absolutePath)
  const childFolderPaths: string[] = []
  const directFiles: FileTreeNode[] = []

  for (const child of node.children) {
    if ('children' in child) {
      const childPath = normalizeFolderPath(child.absolutePath)
      childFolderPaths.push(childPath)
      collectFolderRecords(child, path, out)
      continue
    }
    directFiles.push(child as FileTreeNode)
  }

  out.set(path, { node, path, parentPath, childFolderPaths, directFiles })
}

function isRootLevelFile(parentPath: string | null, vault: VaultState): boolean {
  if (!parentPath) return true
  const normalizedParent = normalizeFolderPath(parentPath)
  return normalizedParent === normalizeFolderPath(vault.writeFolder)
    || normalizedParent === normalizeFolderPath(vault.projectRoot)
}

function shouldProjectGraphNode(
  nodeId: string,
  folderState: ReadonlyMap<string, FolderState>,
  renderedFolderPaths: ReadonlySet<string>,
  vault: VaultState,
): boolean {
  const parentPath = parentFolderPathForFile(nodeId)
  if (isRootLevelFile(parentPath, vault)) return true
  if (!parentPath) return true

  let current: string | null = normalizeFolderPath(parentPath)
  let isDirectParent = true
  while (current) {
    const state = explicitFolderState(folderState, current)
    if (!state) {
      current = parentFolderPath(current)
      isDirectParent = false
      continue
    }
    if (state === 'hidden') {
      return false
    }
    if (state === 'collapsed') {
      return isDirectParent && renderedFolderPaths.has(current)
    }
    if (state === 'expanded') {
      return renderedFolderPaths.has(current)
    }
    current = parentFolderPath(current)
    isDirectParent = false
  }
  return false
}

function cloneFileForProjection(file: FileTreeNode, graphNodes: Readonly<Record<string, GraphNode>>): FileTreeNode {
  return {
    ...file,
    isInGraph: graphNodes[file.absolutePath] !== undefined,
  }
}

function cloneRawFolderForCollapsedProjection(
  node: FolderTreeNode,
  graphNodes: Readonly<Record<string, GraphNode>>,
): FolderTreeNode {
  return {
    ...node,
    children: node.children.map((child) => {
      if ('children' in child) {
        return cloneRawFolderForCollapsedProjection(child, graphNodes)
      }
      return cloneFileForProjection(child as FileTreeNode, graphNodes)
    }),
  }
}

function projectGraph(
  graph: Graph,
  folderState: ReadonlyMap<string, FolderState>,
  renderedFolderPaths: ReadonlySet<string>,
  vault: VaultState,
): Graph {
  const nodes = Object.fromEntries(
    Object.entries(graph.nodes)
      .filter(([nodeId]) => shouldProjectGraphNode(nodeId, folderState, renderedFolderPaths, vault)),
  )
  const visibleNodeIds = new Set(Object.keys(nodes))
  const filteredNodes = Object.fromEntries(
    Object.entries(nodes).map(([nodeId, node]) => [
      nodeId,
      {
        ...node,
        outgoingEdges: node.outgoingEdges.filter((edge) => visibleNodeIds.has(edge.targetId)),
      },
    ]),
  )

  return {
    ...graph,
    nodes: filteredNodes,
  }
}

function projectFolderTree(
  folderTree: FolderTreeNode | null,
  folderState: ReadonlyMap<string, FolderState>,
  graphNodes: Readonly<Record<string, GraphNode>>,
): readonly FolderTreeNode[] {
  if (!folderTree) {
    return []
  }

  const records = new Map<string, FolderRecord>()
  collectFolderRecords(folderTree, null, records)
  const rootPath = normalizeFolderPath(folderTree.absolutePath)

  const renderedPaths = new Set(
    [...records.keys()].filter((path) => path !== rootPath && isFolderRendered(folderState, path)),
  )
  const hasContentMemo = new Map<string, boolean>()
  const hasProjectableContent = (path: string): boolean => {
    const cached = hasContentMemo.get(path)
    if (cached !== undefined) return cached
    const record = records.get(path)
    if (!record) return false
    const hasDirectFile = record.directFiles.some((file) => graphNodes[file.absolutePath] !== undefined)
    const hasChildContent = record.childFolderPaths.some((childPath) =>
      renderedPaths.has(childPath) && hasProjectableContent(childPath),
    )
    const result = hasDirectFile || hasChildContent
    hasContentMemo.set(path, result)
    return result
  }
  const includedPaths = new Set([...renderedPaths].filter(hasProjectableContent))
  const outputParentByPath = new Map<string, string | null>()
  for (const path of includedPaths) {
    const parentPath = records.get(path)?.parentPath ?? null
    outputParentByPath.set(
      path,
      parentPath && includedPaths.has(parentPath) && explicitFolderState(folderState, parentPath) !== 'hidden'
        ? parentPath
        : null,
    )
  }

  const cloneIncludedFolder = (path: string): FolderTreeNode => {
    const record = records.get(path)
    if (!record) {
      throw new Error(`Cannot project unknown folder path ${path}`)
    }
    const state = ownFolderState(folderState, path)
    if (state === 'collapsed') {
      return cloneRawFolderForCollapsedProjection(record.node, graphNodes)
    }

    const children: FolderTreeNode['children'] = [
      ...record.childFolderPaths
        .filter((childPath) => outputParentByPath.get(childPath) === path)
        .map(cloneIncludedFolder),
      ...record.directFiles
        .filter((file) => graphNodes[file.absolutePath] !== undefined)
        .map((file) => cloneFileForProjection(file, graphNodes)),
    ]

    return {
      ...record.node,
      children,
    }
  }

  const rootChildren: FolderTreeNode['children'] = [
    ...[...includedPaths]
      .filter((path) => outputParentByPath.get(path) === null)
      .sort((left, right) => left.localeCompare(right))
      .map(cloneIncludedFolder),
    ...(records.get(rootPath)?.directFiles
      .filter((file) => graphNodes[file.absolutePath] !== undefined)
      .map((file) => cloneFileForProjection(file, graphNodes)) ?? []),
  ]

  return [{
    ...folderTree,
    children: rootChildren,
  }]
}

export function projectSessionState(args: ProjectSessionStateArgs): State {
  const { graph, vault, folderTree, session } = args
  const folderState = folderStateWithImplicitWriteFolder(session.folderState, vault.writeFolder)
  const renderedFolderPaths = new Set(
    [...folderState]
      .filter(([, state]) => state !== 'hidden')
      .map(([path]) => normalizeFolderPath(path)),
  )
  const projectedGraph = projectGraph(graph, folderState, renderedFolderPaths, vault)
  return {
    graph: projectedGraph,
    roots: {
      loaded: new Set<string>([vault.writeFolder, ...vault.readPaths].filter((path) => path.length > 0)),
      folderTree: projectFolderTree(folderTree, folderState, projectedGraph.nodes),
    },
    collapseSet: new Set([...folderState]
      .filter(([, state]) => state === 'collapsed')
      .map(([path]) => folderId(path))),
    selection: new Set(session.selection),
    layout: {
      positions: collectLayoutPositions(graph),
      zoom: session.layout.zoom,
      pan: session.layout.pan,
    },
    meta: {
      schemaVersion: 1,
      revision: 0,
      mutatedAt: new Date(session.lastAccessedAt).toISOString(),
    },
  }
}

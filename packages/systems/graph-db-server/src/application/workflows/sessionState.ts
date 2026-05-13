import {
  buildFolderTree,
  toAbsolutePath,
  type AbsolutePath,
  type FolderTreeNode,
} from '@vt/graph-model'
import { serializeState } from '@vt/graph-state'
import {
  LiveStateSnapshotSchema,
  type LiveStateSnapshot,
  type VaultState,
} from '../../daemon/contract.ts'
import { getGraph } from '../../state/graph-store.ts'
import { getProjectRootWatchedDirectory } from '../../state/watch-folder-store.ts'
import { getDirectoryTree } from '../../data/graph/loading/folderScanner.ts'
import { getReadPaths, getVaultPaths, getWritePath } from '../../state/vaultAllowlist.ts'
import { projectSessionState } from '../session/project.ts'
import { getFolderStateForActiveView } from '../../data/views/folderStateOps.ts'
import { jsonResult, notFoundResult, type HttpResult } from './httpResult.ts'
import type { WorkflowSessionRegistry } from './sessionRoutes.ts'

function resolveWritePath(
  writePathOption: Awaited<ReturnType<typeof getWritePath>>,
): AbsolutePath | null {
  const maybeValue = (writePathOption as { value?: unknown }).value
  return typeof maybeValue === 'string' ? toAbsolutePath(maybeValue) : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function omitNodeContent(node: unknown): unknown {
  if (!isRecord(node)) {
    return node
  }

  const { contentWithoutYamlOrLinks: _contentWithoutYamlOrLinks, ...rest } = node
  return rest
}

function omitGraphNodeContent(snapshot: LiveStateSnapshot): LiveStateSnapshot {
  return {
    ...snapshot,
    graph: {
      ...snapshot.graph,
      nodes: Object.fromEntries(
        Object.entries(snapshot.graph.nodes).map(([nodeId, node]) => [
          nodeId,
          omitNodeContent(node),
        ]),
      ),
    },
  }
}

function readFolderVisibilitySnapshot(
  vaultPath: string,
): Pick<LiveStateSnapshot, 'folderState' | 'activeView'> {
  if (!vaultPath) {
    return {
      folderState: [],
      activeView: { viewId: 'main', name: 'main' },
    }
  }

  return getFolderStateForActiveView(vaultPath) as Pick<
    LiveStateSnapshot,
    'folderState' | 'activeView'
  >
}

export async function readSessionStateWorkflow(
  registry: WorkflowSessionRegistry,
  sessionId: string,
  contentMode: string | undefined,
): Promise<HttpResult> {
  const session = registry.get(sessionId)
  if (!session) {
    return notFoundResult()
  }

  const graph = getGraph()
  const projectRoot = getProjectRootWatchedDirectory()
  const writePath = resolveWritePath(await getWritePath())
  const readPaths = [...(await getReadPaths())]
  const vaultPaths = await getVaultPaths()

  let folderTree: FolderTreeNode | null = null
  if (projectRoot) {
    try {
      const directoryEntry = await getDirectoryTree(projectRoot)
      folderTree = buildFolderTree(
        directoryEntry,
        new Set<string>([...readPaths, ...vaultPaths]),
        writePath,
        new Set<string>(Object.keys(graph.nodes)),
      )
    } catch {
      folderTree = null
    }
  }

  const vault: VaultState = {
    vaultPath: projectRoot ?? '',
    readPaths,
    writePath: writePath ?? projectRoot ?? '',
  }

  const snapshot = projectSessionState({ graph, vault, folderTree, session })
  const body = LiveStateSnapshotSchema.parse({
    ...serializeState(snapshot),
    ...readFolderVisibilitySnapshot(projectRoot ?? ''),
  })
  return jsonResult(contentMode === 'omit' ? omitGraphNodeContent(body) : body)
}

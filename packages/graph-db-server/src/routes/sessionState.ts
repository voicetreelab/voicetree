import type { Hono } from 'hono'
import {
  buildFolderTree,
  getDirectoryTree,
  getGraph,
  getProjectRootWatchedDirectory,
  getReadPaths,
  getVaultPaths,
  getWritePath,
  toAbsolutePath,
  type AbsolutePath,
  type FolderTreeNode,
} from '@vt/graph-model'
import { serializeState } from '@vt/graph-state'
import {
  LiveStateSnapshotSchema,
  type VaultState,
} from '../contract.ts'
import type { SessionRegistry } from '../session/registry.ts'
import { projectSessionState } from '../session/project.ts'

function resolveWritePath(
  writePathOption: Awaited<ReturnType<typeof getWritePath>>,
): AbsolutePath | null {
  // Duck-type fp-ts Option to avoid pulling fp-ts into graph-db-server deps.
  const maybeValue = (writePathOption as { value?: unknown }).value
  return typeof maybeValue === 'string' ? toAbsolutePath(maybeValue) : null
}

export function mountSessionStateRoutes(
  app: Hono,
  registry: SessionRegistry,
): void {
  app.get('/sessions/:sessionId/state', async (c) => {
    const sessionId = c.req.param('sessionId')
    const session = registry.get(sessionId)
    if (!session) {
      return c.notFound()
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
    const body = LiveStateSnapshotSchema.parse(serializeState(snapshot))
    return c.json(body)
  })
}

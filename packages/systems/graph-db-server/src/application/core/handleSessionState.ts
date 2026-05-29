import {
  LiveStateSnapshotSchema,
  type LiveStateSnapshot,
  type VaultState,
} from '@vt/graph-db-server/contract'
import type { AbsolutePath, FolderTreeNode, Graph } from '@vt/graph-model'
import { serializeState } from '@vt/graph-state'
import type { Session } from './session.ts'
import { projectSessionState } from '../session/project.ts'

export type ReadSessionStateInput = {
  readonly session: Session
  readonly contentMode: string | undefined
  readonly graph: Graph
  readonly projectRoot: string | null
  readonly writeFolderPath: AbsolutePath | null
  readonly readPaths: readonly string[]
  readonly folderTree: FolderTreeNode | null
  readonly folderVisibility: Pick<LiveStateSnapshot, 'folderState' | 'activeView'>
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

export function handleReadSessionState(
  input: ReadSessionStateInput,
): { commands: []; response: LiveStateSnapshot } {
  const vault: VaultState = {
    projectRoot: input.projectRoot ?? '',
    readPaths: [...input.readPaths],
    writeFolderPath: input.writeFolderPath ?? input.projectRoot ?? '',
  }

  const snapshot = projectSessionState({
    graph: input.graph,
    vault,
    folderTree: input.folderTree,
    session: input.session,
  })
  const body = LiveStateSnapshotSchema.parse({
    ...serializeState(snapshot),
    ...input.folderVisibility,
  })

  return {
    commands: [],
    response: input.contentMode === 'omit' ? omitGraphNodeContent(body) : body,
  }
}

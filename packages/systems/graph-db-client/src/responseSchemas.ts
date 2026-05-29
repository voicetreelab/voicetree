import {
  UnseenNodeSchema,
  ProjectStateSchema,
  type OpenProjectResponse,
  type UnseenNode,
} from './contract.ts'

export type Schema<T> = {
  parse(input: unknown): T
}

export const UnknownResponseSchema: Schema<unknown> = {
  parse(input: unknown) {
    return input
  },
}

export const WriteFolderPathMutationResponseSchema: Schema<{ writeFolderPath: string }> = {
  parse(input: unknown) {
    if (!isObject(input) || typeof input.writeFolderPath !== 'string') {
      throw new Error('Invalid write-path response body')
    }
    return { writeFolderPath: input.writeFolderPath }
  },
}

export const ReadPathsMutationResponseSchema: Schema<{ readPaths: readonly string[] }> = {
  parse(input: unknown) {
    if (!isObject(input) || !Array.isArray(input.readPaths)) {
      throw new Error('Invalid read-paths response body')
    }
    if (!input.readPaths.every((value) => typeof value === 'string')) {
      throw new Error('Invalid read-paths response body')
    }
    return { readPaths: [...input.readPaths] }
  },
}

function isFolderStateEntry(value: unknown): value is [string, 'expanded' | 'collapsed' | 'hidden'] {
  return Array.isArray(value)
    && value.length === 2
    && typeof value[0] === 'string'
    && (value[1] === 'expanded' || value[1] === 'collapsed' || value[1] === 'hidden')
}

export const OpenProjectResponseSchema: Schema<OpenProjectResponse> = {
  parse(input: unknown) {
    if (
      !isObject(input)
      || typeof input.sessionId !== 'string'
      || typeof input.writeFolderPath !== 'string'
      || !Array.isArray(input.folderState)
      || !input.folderState.every(isFolderStateEntry)
      || !isObject(input.activeView)
      || typeof input.activeView.viewId !== 'string'
      || typeof input.activeView.name !== 'string'
    ) {
      throw new Error('Invalid open-project response body')
    }

    return {
      sessionId: input.sessionId,
      writeFolderPath: input.writeFolderPath,
      projectState: ProjectStateSchema.parse(input.projectState),
      initialProjectedGraph: input.initialProjectedGraph,
      folderState: input.folderState,
      activeView: {
        viewId: input.activeView.viewId,
        name: input.activeView.name,
      },
    }
  },
}

export const ContextNodeResponseSchema: Schema<{ nodeId: string }> = {
  parse(input: unknown) {
    if (!isObject(input) || typeof input.nodeId !== 'string') {
      throw new Error('Invalid context-node response body')
    }
    return { nodeId: input.nodeId }
  },
}

export const ContextNodeFromQuestionResponseSchema: Schema<{
  nodeId: string
  parentNodePath: string
  title: string
}> = {
  parse(input: unknown) {
    if (
      !isObject(input)
      || typeof input.nodeId !== 'string'
      || typeof input.parentNodePath !== 'string'
      || typeof input.title !== 'string'
    ) {
      throw new Error('Invalid question context-node response body')
    }
    return {
      nodeId: input.nodeId,
      parentNodePath: input.parentNodePath,
      title: input.title,
    }
  },
}

export const UnseenNodesResponseSchema: Schema<{ nodes: readonly UnseenNode[] }> = {
  parse(input: unknown) {
    if (!isObject(input) || !Array.isArray(input.nodes)) {
      throw new Error('Invalid unseen-nodes response body')
    }
    return { nodes: input.nodes.map((node) => UnseenNodeSchema.parse(node)) }
  },
}

export const UpdateContextNodeContainedIdsResponseSchema: Schema<{ updated: boolean }> = {
  parse(input: unknown) {
    if (!isObject(input) || typeof input.updated !== 'boolean') {
      throw new Error('Invalid context-node-contained-ids response body')
    }
    return { updated: input.updated }
  },
}

export const WritePositionsResponseSchema: Schema<{ written: number }> = {
  parse(input: unknown) {
    if (!isObject(input) || typeof input.written !== 'number') {
      throw new Error('Invalid write-positions response body')
    }
    return { written: input.written }
  },
}

export const WriteMarkdownFileResponseSchema: Schema<{ ok: true; absolutePath: string; preservedSuffix: string | null }> = {
  parse(input: unknown) {
    if (!isObject(input) || input.ok !== true || typeof input.absolutePath !== 'string') {
      throw new Error('Invalid write-markdown-file response body')
    }
    const preservedSuffix = typeof input.preservedSuffix === 'string'
      ? input.preservedSuffix
      : null
    return { ok: true, absolutePath: input.absolutePath, preservedSuffix }
  },
}

export const FindFileMatchesResponseSchema: Schema<string[]> = {
  parse(input: unknown) {
    if (!isObject(input) || !Array.isArray(input.matches)) {
      throw new Error('Invalid find-file response body')
    }
    if (!input.matches.every((value) => typeof value === 'string')) {
      throw new Error('Invalid find-file response body')
    }
    return [...input.matches]
  },
}

export const UndoRedoResponseSchema: Schema<boolean> = {
  parse(input: unknown) {
    if (!isObject(input) || typeof input.applied !== 'boolean') {
      throw new Error('Invalid undo/redo response body')
    }
    return input.applied
  },
}

export const GraphDiskReconciliationResponseSchema: Schema<{ delta: unknown[] }> = {
  parse(input: unknown) {
    if (!isObject(input) || !Array.isArray(input.delta)) {
      throw new Error('Invalid graph disk reconciliation response body')
    }
    return { delta: [...input.delta] }
  },
}

export const PreviewContainedNodeIdsResponseSchema: Schema<readonly string[]> = {
  parse(input: unknown) {
    if (!isObject(input) || !Array.isArray(input.nodeIds)) {
      throw new Error('Invalid preview-contained-nodes response body')
    }
    if (!input.nodeIds.every((value) => typeof value === 'string')) {
      throw new Error('Invalid preview-contained-nodes response body')
    }
    return [...input.nodeIds]
  },
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

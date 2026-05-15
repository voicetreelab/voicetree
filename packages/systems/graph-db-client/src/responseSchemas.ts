import {
  UnseenNodeSchema,
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

export const ReadPathsMutationResponseSchema: Schema<{ readPaths: string[] }> = {
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

export const WritePathMutationResponseSchema: Schema<{ writePath: string }> = {
  parse(input: unknown) {
    if (!isObject(input) || typeof input.writePath !== 'string') {
      throw new Error('Invalid write-path response body')
    }
    return { writePath: input.writePath }
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

import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, it } from 'vitest'

import { createGraph, type GraphNode } from '@vt/graph-model'
import {
  applyCommandWithDelta,
  emptyState,
  project,
  type State,
} from '../src'

function leaf(id: string, body: string): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: body,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: new Map(),
    },
  }
}

describe('@vt/graph-state system contract', () => {
  it('applies a user-level command journey and projects the resulting graph state', () => {
    const root = '/tmp/vt-state-system'
    const folder = `${root}/work`
    const folderId = `${folder}/`
    const alphaId = `${folder}/alpha.md`
    const betaId = `${folder}/beta.md`

    const alpha = leaf(alphaId, '# Alpha\n\nStart here.')
    const beta = leaf(betaId, '# Beta\n\nFollow up.')
    let state: State = {
      ...emptyState(),
      graph: createGraph({ [alphaId]: alpha }),
      roots: {
        loaded: new Set([root]),
        folderTree: [{
          name: 'vt-state-system',
          absolutePath: root,
          loadState: 'loaded',
          isWriteTarget: true,
          children: [{
            name: 'work',
            absolutePath: folder,
            loadState: 'loaded',
            isWriteTarget: false,
            children: [{
              name: 'alpha.md',
              absolutePath: alphaId,
              isInGraph: true,
            }],
          }],
        }],
      },
    }

    const apply = (command: Parameters<typeof applyCommandWithDelta>[1]) => {
      const result = applyCommandWithDelta(state, command)
      state = result.state
      return result.delta
    }

    expect(project(state).nodes).toContainEqual(expect.objectContaining({
      id: alphaId,
      kind: 'node',
      parent: folderId,
    }))

    expect(apply({ type: 'AddNode', node: beta }).graph).toHaveLength(1)
    expect(apply({
      type: 'AddEdge',
      source: alphaId,
      edge: { targetId: betaId, label: 'next' },
    }).graph).toBeDefined()
    expect(apply({ type: 'Move', id: betaId, to: { x: 120, y: 240 } }).positionsMoved?.get(betaId)).toEqual({
      x: 120,
      y: 240,
    })
    expect(apply({ type: 'Select', ids: [alphaId, betaId] }).selectionAdded).toEqual([
      alphaId,
      betaId,
    ])
    expect(apply({ type: 'Collapse', folder: folderId }).collapseAdded).toEqual([folderId])

    const collapsedProjection = project(state)
    expect(collapsedProjection.revision).toBe(state.meta.revision)
    expect(collapsedProjection.nodes).toContainEqual(expect.objectContaining({
      id: folderId,
      kind: 'folder-collapsed',
    }))
    expect(collapsedProjection.nodes).not.toContainEqual(expect.objectContaining({
      id: betaId,
      kind: 'node',
    }))

    expect(apply({ type: 'Expand', folder: folderId }).collapseRemoved).toEqual([folderId])
    expect(apply({ type: 'RemoveEdge', source: alphaId, targetId: betaId }).graph).toBeDefined()
    expect(apply({ type: 'RemoveNode', id: betaId }).graph).toBeDefined()

    const finalProjection = project(state)
    expect(finalProjection.nodes).toContainEqual(expect.objectContaining({ id: alphaId }))
    expect(finalProjection.nodes).not.toContainEqual(expect.objectContaining({ id: betaId }))
    expect(finalProjection.revision).toBe(8)
  })
})

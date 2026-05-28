import * as O from 'fp-ts/lib/Option.js'
import { beforeEach, describe, expect, it } from 'vitest'

import { createGraph, type GraphNode } from '@vt/graph-model'
import {
  applyCommandWithDelta,
  emptyState,
  project,
  type State,
} from '../../src'

const root = '/tmp/vt-state-contract'
const folder = `${root}/work`
const folderId = `${folder}/`
const alphaId = `${folder}/alpha.md`
const betaId = `${folder}/beta.md`

function leaf(id: string, body: string): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: body,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: {},
    },
  }
}

function initialState(): State {
  const alpha = leaf(alphaId, '# Alpha\n\nStart here.')
  return {
    ...emptyState(),
    graph: createGraph({ [alphaId]: alpha }),
    roots: {
      loaded: new Set([root]),
      folderTree: [{
        name: 'vt-state-contract',
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
}

describe('@vt/graph-state public API contract', () => {
  let state: State
  const beta = leaf(betaId, '# Beta\n\nFollow up.')

  const apply = (command: Parameters<typeof applyCommandWithDelta>[1]) => {
    const result = applyCommandWithDelta(state, command)
    state = result.state
    return result.delta
  }

  beforeEach(() => {
    state = initialState()
  })

  it('projects file nodes under their folder via project()', () => {
    expect(project(state).nodes).toContainEqual(expect.objectContaining({
      id: alphaId,
      kind: 'file',
      parent: folderId,
    }))
  })

  it('normalizes projected markdown content to LF line endings', () => {
    state = {
      ...state,
      graph: createGraph({ [alphaId]: leaf(alphaId, '# Alpha\r\n\r\nStart here.\r\n') }),
    }

    expect(project(state).nodes).toContainEqual(expect.objectContaining({
      id: alphaId,
      content: '# Alpha\n\nStart here.\n',
    }))
  })

  it('AddNode adds the node to the graph delta', () => {
    expect(apply({ type: 'AddNode', node: beta }).graph).toHaveLength(1)
  })

  it('AddEdge connects two existing nodes', () => {
    apply({ type: 'AddNode', node: beta })
    expect(apply({
      type: 'AddEdge',
      source: alphaId,
      edge: { targetId: betaId, label: 'next' },
    }).graph).toBeDefined()
  })

  it('Move records positionsMoved for the moved node', () => {
    apply({ type: 'AddNode', node: beta })
    expect(apply({ type: 'Move', id: betaId, to: { x: 120, y: 240 } }).positionsMoved?.get(betaId))
      .toEqual({ x: 120, y: 240 })
  })

  it('Select records the selected ids in selectionAdded', () => {
    apply({ type: 'AddNode', node: beta })
    expect(apply({ type: 'Select', ids: [alphaId, betaId] }).selectionAdded).toEqual([
      alphaId,
      betaId,
    ])
  })

  const setFolderState = (state: 'expanded' | 'collapsed' | 'hidden') => ({
    type: 'SetFolderState' as const,
    viewId: 'main',
    path: folder,
    state,
  })

  describe('SetFolderState folder visibility', () => {
    beforeEach(() => {
      apply({ type: 'AddNode', node: beta })
    })

    it('collapsed hides children and presents folder as folder-collapsed', () => {
      expect(apply(setFolderState('collapsed')).collapseAdded).toEqual([folderId])

      const projection = project(state)
      expect(projection.revision).toBe(state.meta.revision)
      expect(projection.nodes).toContainEqual(expect.objectContaining({
        id: folderId,
        kind: 'folder-collapsed',
      }))
      expect(projection.nodes).not.toContainEqual(expect.objectContaining({
        id: betaId,
        kind: 'file',
      }))
    })

    it('expanded restores the previously collapsed folder', () => {
      apply(setFolderState('collapsed'))
      expect(apply(setFolderState('expanded')).collapseRemoved).toEqual([folderId])
      expect(project(state).nodes).toContainEqual(expect.objectContaining({
        id: betaId,
        kind: 'file',
      }))
    })
  })

  it('RemoveEdge drops the edge between two nodes', () => {
    apply({ type: 'AddNode', node: beta })
    apply({ type: 'AddEdge', source: alphaId, edge: { targetId: betaId, label: 'next' } })
    expect(apply({ type: 'RemoveEdge', source: alphaId, targetId: betaId }).graph).toBeDefined()
  })

  it('RemoveNode removes the node from the projection', () => {
    apply({ type: 'AddNode', node: beta })
    apply({ type: 'RemoveNode', id: betaId })
    expect(project(state).nodes).not.toContainEqual(expect.objectContaining({ id: betaId }))
    expect(project(state).nodes).toContainEqual(expect.objectContaining({ id: alphaId }))
  })

  it('increments meta.revision on every mutating command', () => {
    const startRev = state.meta.revision
    apply({ type: 'AddNode', node: beta })
    expect(state.meta.revision).toBe(startRev + 1)
    apply({ type: 'AddEdge', source: alphaId, edge: { targetId: betaId, label: 'next' } })
    expect(state.meta.revision).toBe(startRev + 2)
  })
})

import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, test } from 'vitest'
import { createGraph, type GraphNode } from '@vt/graph-model/graph'
import type { Session } from '../session.ts'
import { handleReadSessionState } from '../handleSessionState.ts'

const NODE_ID = '/tmp/vault/docs/one.md'

function sessionFixture(): Session {
  return {
    id: 'session-1',
    folderState: new Map([['/tmp/vault/docs', 'expanded']]),
    collapseSet: new Set<string>(),
    selection: new Set<string>([NODE_ID]),
    expandOverrides: new Set<string>(),
    layout: {
      positions: {},
      pan: { x: 0, y: 0 },
      zoom: 1,
    },
    lastAccessedAt: 100,
  }
}

function graphNodeFixture(): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: NODE_ID,
    contentWithoutYamlOrLinks: '# one\n\nbody',
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: {},
    },
  }
}

describe('handleSessionState', () => {
  test('returns a schema-valid live state snapshot without commands', () => {
    const result = handleReadSessionState({
      session: sessionFixture(),
      contentMode: undefined,
      graph: createGraph({ [NODE_ID]: graphNodeFixture() }),
      projectRoot: '/tmp/vault',
      writeFolder: null,
      readPaths: [],
      folderTree: null,
      folderVisibility: {
        folderState: [],
        activeView: { viewId: 'main', name: 'main' },
      },
    })

    expect(result.commands).toEqual([])
    expect(result.response.activeView.viewId).toBe('main')
    expect(result.response.selection).toEqual([NODE_ID])
    expect(Array.isArray(result.response.folderState)).toBe(true)
    expect(result.response.graph.nodes[NODE_ID]).toHaveProperty(
      'contentWithoutYamlOrLinks',
      '# one\n\nbody',
    )
  })

  test('omits graph node markdown content when requested', () => {
    const result = handleReadSessionState({
      session: sessionFixture(),
      contentMode: 'omit',
      graph: createGraph({ [NODE_ID]: graphNodeFixture() }),
      projectRoot: '/tmp/vault',
      writeFolder: null,
      readPaths: [],
      folderTree: null,
      folderVisibility: {
        folderState: [],
        activeView: { viewId: 'main', name: 'main' },
      },
    })

    expect(result.commands).toEqual([])
    expect(result.response.graph.nodes[NODE_ID]).toBeDefined()
    expect(result.response.graph.nodes[NODE_ID]).not.toHaveProperty(
      'contentWithoutYamlOrLinks',
    )
  })
})

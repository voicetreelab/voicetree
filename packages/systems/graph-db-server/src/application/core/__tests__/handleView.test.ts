import { describe, expect, test } from 'vitest'
import { createEmptyGraph } from '@vt/graph-model/graph'
import type { State } from '@vt/graph-state'
import type { Session } from '../session.ts'
import {
  handleAddExpandOverride,
  handleDeleteExpandOverride,
  handleReadProjectedGraph,
  handleRenderView,
} from '../handleView.ts'

function sessionFixture(): Session {
  return {
    id: 'session-1',
    folderState: new Map(),
    collapseSet: new Set<string>(),
    selection: new Set<string>(),
    expandOverrides: new Set<string>(['/vault/docs']),
    layout: {
      positions: {},
      pan: { x: 0, y: 0 },
      zoom: 1,
    },
    lastAccessedAt: 100,
  }
}

function stateFixture(): State {
  return {
    graph: createEmptyGraph(),
    roots: {
      loaded: new Set<string>(['/vault']),
      folderTree: [],
    },
    collapseSet: new Set<string>(),
    selection: new Set<string>(),
    layout: {
      positions: new Map(),
      pan: { x: 0, y: 0 },
      zoom: 1,
    },
    meta: {
      schemaVersion: 1,
      revision: 7,
      mutatedAt: '1970-01-01T00:00:00.100Z',
    },
  }
}

describe('handleView', () => {
  test('renders a tree-cover response without commands', () => {
    const result = handleRenderView(
      sessionFixture(),
      stateFixture(),
      undefined,
      ['/vault/extra'],
    )

    expect(result).toEqual({
      commands: [],
      response: { output: '', format: 'tree-cover' },
    })
  })

  test('returns the projected graph without commands', () => {
    const result = handleReadProjectedGraph(stateFixture())

    expect(result.commands).toEqual([])
    expect(result.response).toMatchObject({
      nodes: [],
      edges: [],
      rootPath: '/vault',
      revision: 7,
      forests: [],
      arboricity: 0,
      recentNodeIds: [],
    })
  })

  test('adds an expand override immutably and touches the registry', () => {
    const session = sessionFixture()

    const result = handleAddExpandOverride(session, '/vault/new')

    expect(result).toEqual({
      session: {
        ...session,
        expandOverrides: new Set<string>(['/vault/docs', '/vault/new']),
      },
      commands: [{ type: 'RegistryTouch', sessionId: 'session-1' }],
      response: { expandOverrides: ['/vault/docs', '/vault/new'] },
    })
    expect(session.expandOverrides).toEqual(new Set<string>(['/vault/docs']))
  })

  test('deletes an expand override immutably and touches the registry', () => {
    const session = sessionFixture()

    const result = handleDeleteExpandOverride(session, '/vault/docs')

    expect(result).toEqual({
      session: {
        ...session,
        expandOverrides: new Set<string>(),
      },
      commands: [{ type: 'RegistryTouch', sessionId: 'session-1' }],
      response: { expandOverrides: [] },
    })
    expect(session.expandOverrides).toEqual(new Set<string>(['/vault/docs']))
  })
})

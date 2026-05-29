import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, test } from 'vitest'
import { toAbsolutePath } from '@vt/graph-model'
import { createEmptyGraph, createGraph, type GraphNode } from '@vt/graph-model/graph'
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
    expandOverrides: new Set<string>(['/project/docs']),
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
      loaded: new Set<string>(['/project']),
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

function graphNodeFixture(id: string, title: string): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: title,
    nodeUIMetadata: {
      color: O.none,
      position: O.none,
      additionalYAMLProps: {},
    },
  }
}

describe('handleView', () => {
  test('renders a tree-cover response without commands', () => {
    const result = handleRenderView(
      sessionFixture(),
      stateFixture(),
      undefined,
      undefined,
      ['/project/extra'],
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
      rootPath: '/project',
      revision: 7,
      forests: [],
      arboricity: 0,
      recentNodeIds: [],
    })
  })

  test('renders user-collapsed folders from the uncollapsed projected state', () => {
    const root = '/project'
    const docs = '/project/docs'
    const alpha = '/project/docs/alpha.md'
    const beta = '/project/docs/beta.md'
    const session = {
      ...sessionFixture(),
      folderState: new Map<string, 'expanded' | 'collapsed' | 'hidden'>([
        [root, 'expanded'],
        [docs, 'collapsed'],
      ]),
      collapseSet: new Set<string>([`${docs}/`]),
    }
    const state: State = {
      graph: createGraph({
        [alpha]: graphNodeFixture(alpha, 'Alpha'),
        [beta]: graphNodeFixture(beta, 'Beta'),
      }),
      roots: {
        loaded: new Set<string>([root]),
        folderTree: [{
          name: 'project',
          absolutePath: toAbsolutePath(root),
          loadState: 'loaded',
          isWriteTarget: true,
          children: [{
            name: 'docs',
            absolutePath: toAbsolutePath(docs),
            loadState: 'not-loaded',
            isWriteTarget: false,
            children: [
              { name: 'alpha.md', absolutePath: toAbsolutePath(alpha), isInGraph: true },
              { name: 'beta.md', absolutePath: toAbsolutePath(beta), isInGraph: true },
            ],
          }],
        }],
      },
      collapseSet: new Set<string>([`${docs}/`]),
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

    const result = handleRenderView(session, state, undefined, 'main', [])

    expect(result.commands).toEqual([])
    expect(result.response.output).toContain('▢ docs/ [collapsed:user 2 nodes')
  })

  test('adds an expand override immutably and touches the registry', () => {
    const session = sessionFixture()

    const result = handleAddExpandOverride(session, '/project/new')

    expect(result).toEqual({
      session: {
        ...session,
        expandOverrides: new Set<string>(['/project/docs', '/project/new']),
      },
      commands: [{ type: 'RegistryTouch', sessionId: 'session-1' }],
      response: { expandOverrides: ['/project/docs', '/project/new'] },
    })
    expect(session.expandOverrides).toEqual(new Set<string>(['/project/docs']))
  })

  test('deletes an expand override immutably and touches the registry', () => {
    const session = sessionFixture()

    const result = handleDeleteExpandOverride(session, '/project/docs')

    expect(result).toEqual({
      session: {
        ...session,
        expandOverrides: new Set<string>(),
      },
      commands: [{ type: 'RegistryTouch', sessionId: 'session-1' }],
      response: { expandOverrides: [] },
    })
    expect(session.expandOverrides).toEqual(new Set<string>(['/project/docs']))
  })
})

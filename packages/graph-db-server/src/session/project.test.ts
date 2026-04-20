import { describe, test, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { toAbsolutePath } from '@vt/graph-model'
import type { FolderTreeNode, Graph, GraphNode } from '@vt/graph-model'
import type { State } from '@vt/graph-state'
import type { VaultState } from '../contract.ts'
import type { Session } from './types.ts'
import { projectSessionState } from './project.ts'

function makeNode(id: string, content: string, position?: { x: number; y: number }): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: [],
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: content,
    nodeUIMetadata: {
      color: O.none,
      position: position ? O.some(position) : O.none,
      additionalYAMLProps: new Map(),
    },
  }
}

function makeGraph(): Graph {
  return {
    nodes: {
      '/vault/docs/a.md': makeNode('/vault/docs/a.md', 'A', { x: 10, y: 20 }),
      '/vault/docs/b.md': makeNode('/vault/docs/b.md', 'B'),
    },
    incomingEdgesIndex: new Map(),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map(),
  }
}

function makeFolderTree(): FolderTreeNode {
  return {
    name: 'vault',
    absolutePath: toAbsolutePath('/vault'),
    children: [
      {
        name: 'docs',
        absolutePath: toAbsolutePath('/vault/docs'),
        children: [
          { name: 'a.md', absolutePath: toAbsolutePath('/vault/docs/a.md'), isInGraph: true },
          { name: 'b.md', absolutePath: toAbsolutePath('/vault/docs/b.md'), isInGraph: true },
        ],
        loadState: 'loaded',
        isWriteTarget: false,
      },
    ],
    loadState: 'loaded',
    isWriteTarget: true,
  }
}

function makeVault(): VaultState {
  return {
    vaultPath: '/vault',
    readPaths: ['/vault/docs'],
    writePath: '/vault',
  }
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    collapseSet: new Set(),
    selection: new Set(),
    layout: { positions: {}, pan: { x: 0, y: 0 }, zoom: 1 },
    lastAccessedAt: 1700000000000,
    ...overrides,
  }
}

describe('projectSessionState', () => {
  test('parity: hand-built golden fixture matches the projection output', () => {
    // Golden fixture: the State shape today's `buildLiveStateSnapshot` emits
    // for these inputs. Hand-constructed per the reference logic in
    // webapp/src/shell/edge/main/state/buildLiveStateSnapshot.ts.
    const graph = makeGraph()
    const folderTree = makeFolderTree()
    const vault = makeVault()
    const session = makeSession({
      collapseSet: new Set(['/vault/docs/']),
      selection: new Set(['/vault/docs/a.md']),
      layout: { positions: {}, pan: { x: 5, y: 6 }, zoom: 2 },
      lastAccessedAt: 1700000000000,
    })

    const expected: State = {
      graph,
      roots: {
        loaded: new Set(['/vault/docs']),
        folderTree: [folderTree],
      },
      collapseSet: new Set(['/vault/docs/']),
      selection: new Set(['/vault/docs/a.md']),
      layout: {
        positions: new Map([['/vault/docs/a.md', { x: 10, y: 20 }]]),
        zoom: 2,
        pan: { x: 5, y: 6 },
      },
      meta: {
        schemaVersion: 1,
        revision: 0,
        mutatedAt: new Date(1700000000000).toISOString(),
      },
    }

    const result = projectSessionState({ graph, vault, folderTree, session })
    expect(result).toEqual(expected)
  })

  test('isolation: two sessions with different collapseSets produce different snapshots on the same inputs', () => {
    const graph = makeGraph()
    const folderTree = makeFolderTree()
    const vault = makeVault()

    const sessionA = makeSession({ collapseSet: new Set(['/vault/docs/']) })
    const sessionB = makeSession({ collapseSet: new Set() })

    const snapA = projectSessionState({ graph, vault, folderTree, session: sessionA })
    const snapB = projectSessionState({ graph, vault, folderTree, session: sessionB })

    expect([...snapA.collapseSet]).toEqual(['/vault/docs/'])
    expect([...snapB.collapseSet]).toEqual([])
    expect(snapA.collapseSet).not.toEqual(snapB.collapseSet)
    // Everything else (including session-independent graph+folderTree) should be equal.
    expect(snapA.graph).toEqual(snapB.graph)
    expect(snapA.roots).toEqual(snapB.roots)
  })

  test('null folderTree produces an empty roots.folderTree', () => {
    const snapshot = projectSessionState({
      graph: makeGraph(),
      vault: makeVault(),
      folderTree: null,
      session: makeSession(),
    })
    expect(snapshot.roots.folderTree).toEqual([])
  })

  test('layout.positions is sourced from graph, not from session.layout.positions', () => {
    const session = makeSession({
      layout: {
        positions: { '/vault/docs/a.md': { x: 999, y: 999 } },
        pan: { x: 0, y: 0 },
        zoom: 1,
      },
    })
    const snapshot = projectSessionState({
      graph: makeGraph(),
      vault: makeVault(),
      folderTree: makeFolderTree(),
      session,
    })
    // Graph has a.md at (10, 20); session's 999/999 is ignored by the projection.
    expect(snapshot.layout.positions.get('/vault/docs/a.md')).toEqual({ x: 10, y: 20 })
  })
})

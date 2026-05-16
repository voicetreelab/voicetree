import { describe, test, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { toAbsolutePath } from '@vt/graph-model'
import type { FolderTreeNode, Graph, GraphNode } from '@vt/graph-model'
import type { State } from '@vt/graph-state'
import type { VaultState } from '../../daemon/contract.ts'
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
      {
        name: 'node_modules',
        absolutePath: toAbsolutePath('/vault/node_modules'),
        children: [
          {
            name: 'dep',
            absolutePath: toAbsolutePath('/vault/node_modules/dep'),
            children: [
              { name: 'index.js', absolutePath: toAbsolutePath('/vault/node_modules/dep/index.js'), isInGraph: false },
            ],
            loadState: 'not-loaded',
            isWriteTarget: false,
          },
        ],
        loadState: 'not-loaded',
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
    expandOverrides: new Set(),
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
    // Under expand-descendants-of-target semantics: /vault writePath expands
    // every folder under it (docs, node_modules, node_modules/dep). Manual
    // collapse (collapseSet) is now conveyed through state.collapseSet alone —
    // the serialized folder tree keeps full children so downstream consumers
    // (graph-state projection, sidebar) can compute child counts and render
    // independently of the graph collapse state.
    const expectedFolderTree: FolderTreeNode = folderTree
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
        loaded: new Set(['/vault', '/vault/docs']),
        folderTree: [expectedFolderTree],
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
    // Collapse state is conveyed through state.collapseSet alone — the
    // serialized folder tree itself doesn't change between collapsed and
    // expanded sessions (only the graph projection downstream reacts).
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

  test('folders within a loaded vault path expand by default', () => {
    const snapshot = projectSessionState({
      graph: makeGraph(),
      vault: makeVault(),
      folderTree: makeFolderTree(),
      session: makeSession(),
    })

    const root = snapshot.roots.folderTree[0]
    const docs = root.children.find((child) => child.name === 'docs') as FolderTreeNode
    const nodeModules = root.children.find((child) => child.name === 'node_modules') as FolderTreeNode
    const dep = nodeModules.children.find((child) => child.name === 'dep') as FolderTreeNode

    // /vault writePath expands every descendant folder; /vault/docs readPath
    // additionally expands docs. node_modules expands because /vault is an
    // ancestor target — folder visibility is driven by loaded targets, not by
    // an explicit ignore list.
    expect(docs.children.map((child) => child.name)).toEqual(['a.md', 'b.md'])
    expect(nodeModules.children.map((child) => child.name)).toEqual(['dep'])
    expect(dep.children.map((child) => child.name)).toEqual(['index.js'])
  })

  test('manual collapse does not prune children from the serialized folder tree', () => {
    // Regression: previously, collapsing a folder pruned its children to [],
    // which caused downstream graph-state projection to drop the folder
    // entirely (countRecursiveProjectableFileDescendants → 0 short-circuit).
    // Collapse is now conveyed via state.collapseSet alone so the projector
    // can emit a `folder-collapsed` node with a correct childCount.
    const snapshot = projectSessionState({
      graph: makeGraph(),
      vault: makeVault(),
      folderTree: makeFolderTree(),
      session: makeSession({ collapseSet: new Set(['/vault/docs/']) }),
    })

    const root = snapshot.roots.folderTree[0]
    const docs = root.children.find((child) => child.name === 'docs') as FolderTreeNode

    expect(docs.children.map((child) => child.name)).toEqual(['a.md', 'b.md'])
    expect([...snapshot.collapseSet]).toEqual(['/vault/docs/'])
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

import { describe, test, expect } from 'vitest'
import type { FolderTreeNode } from '@vt/graph-model'
import { project, type State } from '@vt/graph-state'
import { projectSessionState } from './project.ts'
import { makeProjectSessionStateFixtures } from './project/__tests__/fixtures.ts'

const {
  makeDynamicFolderTree,
  makeDynamicMoveGraph,
  makeFolderTree,
  makeGraph,
  makeSession,
  makeVault,
  makeVisibilityFolderTree,
  makeVisibilityGraph,
} = makeProjectSessionStateFixtures()

describe('projectSessionState', () => {
  test('parity: hand-built golden fixture matches the projection output', () => {
    // Golden fixture: the State shape today's `buildLiveStateSnapshot` emits
    // for these inputs. Hand-constructed per the reference logic in
    // webapp/src/shell/edge/main/state/buildLiveStateSnapshot.ts.
    const graph = makeGraph()
    const folderTree = makeFolderTree()
    // Under expand-descendants-of-target semantics: /vault writeFolder expands
    // every folder under it (docs, node_modules, node_modules/dep). Manual
    // collapse (collapseSet) is now conveyed through state.collapseSet alone —
    // the serialized folder tree keeps full children so downstream consumers
    // (graph-state projection, sidebar) can compute child counts and render
    // independently of the graph collapse state.
    const expectedFolderTree: FolderTreeNode = {
      ...folderTree,
      children: folderTree.children.filter((child) => child.name === 'docs'),
    }
    const vault = makeVault()
    const session = makeSession({
      folderState: new Map([['/vault/docs', 'collapsed']]),
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

    const sessionA = makeSession({ folderState: new Map([['/vault/docs', 'collapsed']]), collapseSet: new Set(['/vault/docs/']) })
    const sessionB = makeSession({ folderState: new Map([['/vault/docs', 'expanded']]), collapseSet: new Set() })

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

  test('implicit write path renders folders with graph content and prunes empty folders', () => {
    const snapshot = projectSessionState({
      graph: makeGraph(),
      vault: makeVault(),
      folderTree: makeFolderTree(),
      session: makeSession(),
    })

    const root = snapshot.roots.folderTree[0]
    expect(root.children.map((child) => child.name)).toEqual(['docs'])
    expect(Object.keys(snapshot.graph.nodes).sort()).toEqual([
      '/vault/docs/a.md',
      '/vault/docs/b.md',
    ])
  })

  test('new folders under an expanded write path inherit visibility so moved targets and healed links project', () => {
    const snapshot = projectSessionState({
      graph: makeDynamicMoveGraph(),
      vault: makeVault(),
      folderTree: makeDynamicFolderTree(),
      session: makeSession({ folderState: new Map([['/vault', 'expanded']]) }),
    })

    const root = snapshot.roots.folderTree[0]
    const archive = root.children.find((child) => child.name === 'archive') as FolderTreeNode
    const source = snapshot.graph.nodes['/vault/source.md']
    const projectedIds = project(snapshot).nodes.map((node) => node.id)

    expect(archive.children.map((child) => child.name)).toEqual(['target.md'])
    expect(snapshot.graph.nodes['/vault/archive/target.md']).toBeDefined()
    expect(source.outgoingEdges).toEqual([
      { targetId: '/vault/archive/target.md', label: 'target' },
    ])
    expect(projectedIds).toContain('/vault/archive/')
    expect(projectedIds).toContain('/vault/archive/target.md')
  })

  test('write path behaves as an implicit expanded ancestor without persisting a view row', () => {
    const snapshot = projectSessionState({
      graph: makeDynamicMoveGraph(),
      vault: makeVault(),
      folderTree: makeDynamicFolderTree(),
      session: makeSession({ folderState: new Map() }),
    })

    const projectedIds = project(snapshot).nodes.map((node) => node.id)

    expect(snapshot.graph.nodes['/vault/archive/target.md']).toBeDefined()
    expect(snapshot.graph.nodes['/vault/docs/archive/target.md']).toBeDefined()
    expect(projectedIds).toContain('/vault/archive/')
    expect(projectedIds).toContain('/vault/docs/archive/')
  })

  test.each(['hidden', 'collapsed'] as const)(
    'new folders under an explicit %s parent do not leak visible graph contents',
    (parentState) => {
      const snapshot = projectSessionState({
        graph: makeDynamicMoveGraph(),
        vault: makeVault(),
        folderTree: makeDynamicFolderTree(),
        session: makeSession({
          folderState: new Map([
            ['/vault', 'expanded'],
            ['/vault/docs', parentState],
          ]),
        }),
      })

      const projected = project(snapshot)
      const projectedIds = projected.nodes.map((node) => node.id)

      expect(snapshot.graph.nodes['/vault/docs/archive/target.md']).toBeUndefined()
      expect(projectedIds).not.toContain('/vault/docs/archive/')
      expect(projectedIds).not.toContain('/vault/docs/archive/target.md')
    },
  )

  test('explicit hidden rows still override inherited expanded visibility', () => {
    const snapshot = projectSessionState({
      graph: makeDynamicMoveGraph(),
      vault: makeVault(),
      folderTree: makeDynamicFolderTree(),
      session: makeSession({
        folderState: new Map([
          ['/vault', 'expanded'],
          ['/vault/docs', 'hidden'],
        ]),
      }),
    })

    expect(snapshot.graph.nodes['/vault/docs/direct.md']).toBeUndefined()
    expect(snapshot.graph.nodes['/vault/docs/archive/target.md']).toBeUndefined()
    expect(snapshot.collapseSet).toEqual(new Set())
  })

  test('explicit collapsed rows are preserved while inherited descendants stay hidden downstream', () => {
    const snapshot = projectSessionState({
      graph: makeDynamicMoveGraph(),
      vault: makeVault(),
      folderTree: makeDynamicFolderTree(),
      session: makeSession({
        folderState: new Map([
          ['/vault', 'expanded'],
          ['/vault/docs', 'collapsed'],
        ]),
      }),
    })

    const projected = project(snapshot)
    const projectedIds = projected.nodes.map((node) => node.id)

    expect([...snapshot.collapseSet]).toEqual(['/vault/docs/'])
    expect(snapshot.graph.nodes['/vault/docs/direct.md']).toBeDefined()
    expect(snapshot.graph.nodes['/vault/docs/archive/target.md']).toBeUndefined()
    expect(projectedIds).toContain('/vault/docs/')
    expect(projectedIds).not.toContain('/vault/docs/direct.md')
    expect(projectedIds).not.toContain('/vault/docs/archive/target.md')
  })

  test('new folders under an expanded write path inherit visibility so moved targets and healed links project', () => {
    const snapshot = projectSessionState({
      graph: makeDynamicMoveGraph(),
      vault: makeVault(),
      folderTree: makeDynamicFolderTree(),
      session: makeSession({ folderState: new Map([['/vault', 'expanded']]) }),
    })

    const root = snapshot.roots.folderTree[0]
    const archive = root.children.find((child) => child.name === 'archive') as FolderTreeNode
    const source = snapshot.graph.nodes['/vault/source.md']
    const projectedIds = project(snapshot).nodes.map((node) => node.id)

    expect(archive.children.map((child) => child.name)).toEqual(['target.md'])
    expect(snapshot.graph.nodes['/vault/archive/target.md']).toBeDefined()
    expect(source.outgoingEdges).toEqual([
      { targetId: '/vault/archive/target.md', label: 'target' },
    ])
    expect(projectedIds).toContain('/vault/archive/')
    expect(projectedIds).toContain('/vault/archive/target.md')
  })

  test.each(['hidden', 'collapsed'] as const)(
    'new folders under an explicit %s parent do not leak visible graph contents',
    (parentState) => {
      const snapshot = projectSessionState({
        graph: makeDynamicMoveGraph(),
        vault: makeVault(),
        folderTree: makeDynamicFolderTree(),
        session: makeSession({
          folderState: new Map([
            ['/vault', 'expanded'],
            ['/vault/docs', parentState],
          ]),
        }),
      })

      const projected = project(snapshot)
      const projectedIds = projected.nodes.map((node) => node.id)

      expect(snapshot.graph.nodes['/vault/docs/archive/target.md']).toBeUndefined()
      expect(projectedIds).not.toContain('/vault/docs/archive/')
      expect(projectedIds).not.toContain('/vault/docs/archive/target.md')
    },
  )

  test('explicit hidden rows still override inherited expanded visibility', () => {
    const snapshot = projectSessionState({
      graph: makeDynamicMoveGraph(),
      vault: makeVault(),
      folderTree: makeDynamicFolderTree(),
      session: makeSession({
        folderState: new Map([
          ['/vault', 'expanded'],
          ['/vault/docs', 'hidden'],
        ]),
      }),
    })

    expect(snapshot.graph.nodes['/vault/docs/direct.md']).toBeUndefined()
    expect(snapshot.graph.nodes['/vault/docs/archive/target.md']).toBeUndefined()
    expect(snapshot.collapseSet).toEqual(new Set())
  })

  test('explicit collapsed rows are preserved while inherited descendants stay hidden downstream', () => {
    const snapshot = projectSessionState({
      graph: makeDynamicMoveGraph(),
      vault: makeVault(),
      folderTree: makeDynamicFolderTree(),
      session: makeSession({
        folderState: new Map([
          ['/vault', 'expanded'],
          ['/vault/docs', 'collapsed'],
        ]),
      }),
    })

    const projected = project(snapshot)
    const projectedIds = projected.nodes.map((node) => node.id)

    expect([...snapshot.collapseSet]).toEqual(['/vault/docs/'])
    expect(snapshot.graph.nodes['/vault/docs/direct.md']).toBeDefined()
    expect(snapshot.graph.nodes['/vault/docs/archive/target.md']).toBeUndefined()
    expect(projectedIds).toContain('/vault/docs/')
    expect(projectedIds).not.toContain('/vault/docs/direct.md')
    expect(projectedIds).not.toContain('/vault/docs/archive/target.md')
  })

  test('expanded folder state renders that folder as an implicit root with direct file children', () => {
    const snapshot = projectSessionState({
      graph: makeGraph(),
      vault: makeVault(),
      folderTree: makeFolderTree(),
      session: makeSession({ folderState: new Map([['/vault/docs', 'expanded']]) }),
    })

    const root = snapshot.roots.folderTree[0]
    const docs = root.children.find((child) => child.name === 'docs') as FolderTreeNode

    expect(docs.children.map((child) => child.name)).toEqual(['a.md', 'b.md'])
    expect(Object.keys(snapshot.graph.nodes).sort()).toEqual(['/vault/docs/a.md', '/vault/docs/b.md'])
  })

  test('hidden ancestor makes an expanded child folder project as a graph root', () => {
    const snapshot = projectSessionState({
      graph: makeVisibilityGraph(),
      vault: makeVault(),
      folderTree: makeVisibilityFolderTree(),
      session: makeSession({
        folderState: new Map([
          ['/vault/workspace', 'hidden'],
          ['/vault/workspace/feature', 'expanded'],
        ]),
      }),
    })

    const projected = project(snapshot)
    const feature = projected.nodes.find((node) => node.id === '/vault/workspace/feature/')
    const workspace = projected.nodes.find((node) => node.id === '/vault/workspace/')

    expect(workspace).toBeUndefined()
    expect(feature).toMatchObject({ kind: 'folder' })
    expect(feature).not.toHaveProperty('parent')
    expect(projected.nodes.find((node) => node.id === '/vault/workspace/feature/leaf.md')).toMatchObject({
      parent: '/vault/workspace/feature/',
    })
  })

  test('hidden folders remove their files and edges from the projected graph input', () => {
    const snapshot = projectSessionState({
      graph: makeVisibilityGraph(),
      vault: makeVault(),
      folderTree: makeVisibilityFolderTree(),
      session: makeSession({
        folderState: new Map([
          ['/vault/public', 'expanded'],
          ['/vault/secret', 'hidden'],
        ]),
      }),
    })

    expect(Object.keys(snapshot.graph.nodes).sort()).toEqual([
      '/vault/public/target.md',
      '/vault/root.md',
      '/vault/workspace/feature/leaf.md',
    ])
    expect(project(snapshot).edges).toEqual([])
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
      session: makeSession({
        folderState: new Map([['/vault/docs', 'collapsed']]),
        collapseSet: new Set(['/vault/docs/']),
      }),
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
      session: makeSession({
        ...session,
        folderState: new Map([['/vault/docs', 'expanded']]),
      }),
    })
    // Graph has a.md at (10, 20); session's 999/999 is ignored by the projection.
    expect(snapshot.layout.positions.get('/vault/docs/a.md')).toEqual({ x: 10, y: 20 })
  })
})

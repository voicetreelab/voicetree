import { describe, test, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { toAbsolutePath } from '@vt/graph-model'
import type { FolderTreeNode, Graph, GraphNode } from '@vt/graph-model'
import { project } from '@vt/graph-state'
import { projectSessionState } from './project.ts'
import type { Session } from './types.ts'

// ── Invariant under test ──────────────────────────────────────────────────────
// Collapsing a folder rolls every external→contained edge up onto the folder
// node as an aggregated "synthetic" edge. This guards that the aggregation is a
// pure function of the graph + collapse state: collapse → expand → re-collapse
// must yield the SAME aggregated incoming edges on both collapses.
//
// Provenance: a user reported aggregated incoming edges vanishing after an
// expand→recollapse cycle (vt_layout_fixes/voicetree-30-5/task_v3xme4). Driving
// the real projection across the cycle — both with these fixtures and against a
// live daemon snapshot — showed the edges are preserved. The reported loss was a
// side-effect of a separate, already-fixed broken-undo bug
// (graph-model reverseDelta) that rewrote the contained nodes' incoming links to
// point at restored originals OUTSIDE the folder between the two collapses, so
// re-collapse had nothing left to aggregate. This test is the standing guard for
// the projection layer's idempotency that such a regression would trip.

function node(id: string, edges: GraphNode['outgoingEdges'] = []): GraphNode {
  return {
    kind: 'leaf',
    outgoingEdges: edges,
    absoluteFilePathIsID: id,
    contentWithoutYamlOrLinks: id,
    nodeUIMetadata: { color: O.none, position: O.none, additionalYAMLProps: new Map() },
  }
}

// External root-level node links INTO a child of the folder, so collapsing the
// folder must surface one aggregated incoming edge on the folder node.
function makeGraph(): Graph {
  return {
    nodes: {
      '/project/root.md': node('/project/root.md', [{ targetId: '/project/docs/a.md', label: 'into' }]),
      '/project/docs/a.md': node('/project/docs/a.md'),
      '/project/docs/b.md': node('/project/docs/b.md'),
    },
    incomingEdgesIndex: new Map([['/project/docs/a.md', ['/project/root.md']]]),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map(),
  }
}

function makeFolderTree(): FolderTreeNode {
  return {
    name: 'project',
    absolutePath: toAbsolutePath('/project'),
    children: [
      { name: 'root.md', absolutePath: toAbsolutePath('/project/root.md'), isInGraph: true },
      {
        name: 'docs',
        absolutePath: toAbsolutePath('/project/docs'),
        children: [
          { name: 'a.md', absolutePath: toAbsolutePath('/project/docs/a.md'), isInGraph: true },
          { name: 'b.md', absolutePath: toAbsolutePath('/project/docs/b.md'), isInGraph: true },
        ],
        loadState: 'loaded',
        isWriteTarget: false,
      },
    ],
    loadState: 'loaded',
    isWriteTarget: true,
  }
}

function makeSession(): Session {
  return {
    id: 's1',
    folderState: new Map(),
    collapseSet: new Set(),
    selection: new Set(),
    expandOverrides: new Set(),
    layout: { positions: {}, pan: { x: 0, y: 0 }, zoom: 1 },
    lastAccessedAt: 1700000000000,
  }
}

const FOLDER_ID = '/project/docs/'

// Faithful copy of routes/session-endpoints/folderState.ts#syncSessionCollapseSet:
// the webapp strips the trailing slash before the set-folder call, then the
// session's folderState + collapseSet are mutated in lockstep.
function normalizeFolderId(path: string): string {
  const trimmed = path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path
  return trimmed.endsWith('/') ? trimmed : `${trimmed}/`
}
function setFolderState(session: Session, path: string, state: 'expanded' | 'collapsed' | 'hidden'): void {
  session.folderState.set(path, state)
  if (state === 'collapsed') {
    session.collapseSet.add(normalizeFolderId(path))
    return
  }
  session.collapseSet.delete(normalizeFolderId(path))
}

function aggregatedIncomingEdgeIds(session: Session, readPaths: readonly string[]): readonly string[] {
  const snapshot = projectSessionState({
    graph: makeGraph(),
    project: { projectRoot: '/project', readPaths: [...readPaths], writeFolderPath: '/project' },
    folderTree: makeFolderTree(),
    session,
  })
  return project(snapshot).edges
    .filter((edge) => edge.kind === 'synthetic' && edge.target === FOLDER_ID)
    .map((edge) => edge.id)
    .sort()
}

describe('folder collapse aggregates external incoming edges idempotently', () => {
  test('collapse → expand → re-collapse yields identical aggregated incoming edges', () => {
    const session = makeSession()
    const folderPath = '/project/docs'

    // Collapse #1 — folder is not yet a read path.
    setFolderState(session, folderPath, 'collapsed')
    const firstCollapse = aggregatedIncomingEdgeIds(session, [])

    // Expand — the live route also runs AddProjectReadPath(folder), so the
    // re-collapse below sees the folder as a read path. Exercising that
    // asymmetry proves read-path growth does not change the aggregation.
    setFolderState(session, folderPath, 'expanded')
    expect(aggregatedIncomingEdgeIds(session, [folderPath])).toEqual([])

    // Collapse #2 — folder is now a loaded read path (collapse never removes it).
    setFolderState(session, folderPath, 'collapsed')
    const secondCollapse = aggregatedIncomingEdgeIds(session, [folderPath])

    expect(firstCollapse).toEqual(['synthetic:/project/docs/:in:/project/root.md'])
    expect(secondCollapse).toEqual(firstCollapse)
  })
})

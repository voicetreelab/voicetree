import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, it } from 'vitest'
import type { Graph, GraphNode, NodeIdAndFilePath } from '@vt/graph-model/pure/graph'
import type { State } from '@vt/graph-state'

import {
  applyDeltaToStateCaptureOverlay,
  buildCapturedSerializedState,
  createStateCaptureOverlay,
} from '../src/commands/run'
import type { CyDump } from '../src/debug/cyStateShape'

function buildGraph(nodeIds: readonly NodeIdAndFilePath[]): Graph {
  const nodes = Object.fromEntries(
    nodeIds.map(nodeId => {
      const node: GraphNode = {
        outgoingEdges: [],
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: `# ${nodeId.split('/').pop()}\n`,
        nodeUIMetadata: {
          color: O.none,
          position: O.none,
          additionalYAMLProps: new Map(),
          isContextNode: false,
        },
      }
      return [nodeId, node]
    }),
  )

  return {
    nodes,
    incomingEdgesIndex: new Map(),
    nodeByBaseName: new Map(),
    unresolvedLinksIndex: new Map(),
  }
}

describe('captureSerializedState helpers', () => {
  it('emits collapseSet, selection, roots.loaded, layout.pan, and layout.zoom from serialized/overlay state', () => {
    const ROOT_A = '/tmp/vt-capture/root-a'
    const ROOT_B = '/tmp/vt-capture/root-b'
    const NODE_A = `${ROOT_A}/a.md` as NodeIdAndFilePath
    const NODE_B = `${ROOT_B}/b.md` as NodeIdAndFilePath
    const FOLDER = `${ROOT_A}/tasks/`

    const state: State = {
      graph: buildGraph([NODE_A, NODE_B]),
      roots: { loaded: new Set([ROOT_A, ROOT_B]), folderTree: [] },
      collapseSet: new Set(),
      selection: new Set(),
      layout: {
        positions: new Map([
          [NODE_A, { x: 10, y: 20 }],
          [NODE_B, { x: 30, y: 40 }],
        ]),
      },
      meta: { schemaVersion: 1, revision: 0 },
    }

    let overlay = createStateCaptureOverlay(state)
    overlay = applyDeltaToStateCaptureOverlay(overlay, {
      revision: 1,
      cause: { type: 'Collapse', folder: FOLDER },
      collapseAdded: [FOLDER],
    })
    overlay = applyDeltaToStateCaptureOverlay(overlay, {
      revision: 2,
      cause: { type: 'Select', ids: [NODE_B, NODE_A] },
      selectionAdded: [NODE_B, NODE_A],
    })
    overlay = applyDeltaToStateCaptureOverlay(overlay, {
      revision: 3,
      cause: { type: 'UnloadRoot', root: ROOT_A },
      rootsUnloaded: [ROOT_A],
    })
    overlay = applyDeltaToStateCaptureOverlay(overlay, {
      revision: 4,
      cause: { type: 'SetPan', pan: { x: 15, y: -5 } },
      layoutChanged: { pan: { x: 15, y: -5 } },
    })
    overlay = applyDeltaToStateCaptureOverlay(overlay, {
      revision: 5,
      cause: { type: 'SetZoom', zoom: 1.75 },
      layoutChanged: { zoom: 1.75 },
    })

    const rendered: CyDump = {
      nodes: [],
      edges: [],
      viewport: {
        zoom: 2.25,
        pan: { x: 120, y: -40 },
      },
      selection: [],
    }

    const captured = buildCapturedSerializedState(state, overlay, rendered)

    expect(captured.collapseSet).toEqual([FOLDER])
    expect(captured.selection).toEqual([NODE_B, NODE_A])
    expect(captured.roots.loaded).toEqual([ROOT_B])
    expect(captured.layout.zoom).toBe(1.75)
    expect(captured.layout.pan).toEqual({ x: 15, y: -5 })
    expect(captured.layout.positions).toContainEqual([NODE_A, { x: 10, y: 20 }])
    expect(captured.layout.positions).toContainEqual([NODE_B, { x: 30, y: 40 }])
  })
})

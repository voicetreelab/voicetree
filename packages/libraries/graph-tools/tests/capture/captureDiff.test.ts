import { describe, expect, it } from 'vitest'
import type { SerializedState } from '@vt/graph-state'
import { diffCaptures, type Snapshot } from '../../src/debug/state/captureDiff'

function makeState(selection: readonly string[], revision: number, mutatedAt: string): SerializedState {
  return {
    graph: {
      nodes: {
        'a.md': {
          outgoingEdges: [],
          absoluteFilePathIsID: 'a.md',
          contentWithoutYamlOrLinks: 'a',
          nodeUIMetadata: {
            color: { _tag: 'None' },
            position: { _tag: 'None' },
            additionalYAMLProps: [],
          },
        },
      },
      incomingEdgesIndex: [],
      nodeByBaseName: [],
      unresolvedLinksIndex: [],
    },
    roots: {
      loaded: ['/tmp/project'],
      folderTree: [],
    },
    collapseSet: [],
    selection: [...selection],
    layout: {
      positions: [],
      zoom: 1,
      pan: { x: 0, y: 0 },
    },
    meta: {
      schemaVersion: 1,
      revision,
      mutatedAt,
    },
  }
}

function makeSnapshot(selection: readonly string[], revision: number, timestamp: string): Snapshot {
  return {
    state: makeState(selection, revision, timestamp),
    cyDump: {
      nodes: [
        {
          id: 'a.md',
          classes: selection.includes('a.md') ? ['selected', 'file'] : ['file'],
          position: { x: 10, y: 20 },
          visible: true,
        },
      ],
      edges: [],
      viewport: { zoom: 1, pan: { x: 0, y: 0 } },
      selection: [...selection],
    },
    focused: null,
    selection: [...selection],
    zoom: 1,
    pan: { x: 0, y: 0 },
    timestamp,
  }
}

describe('diffCaptures', () => {
  it('reports only selection when selection-specific fields change', () => {
    const before = makeSnapshot([], 10, '2026-04-19T00:00:00.000Z')
    const after = makeSnapshot(['a.md'], 11, '2026-04-19T00:00:05.000Z')

    expect(diffCaptures(before, after)).toEqual({ changed: ['selection'] })
  })

  it('handles on-disk captures that omit optional roots.loaded / collapseSet', () => {
    // serializeState() omits roots.loaded and collapseSet entirely (they are
    // derived on hydrate), so real capture files lack these fields. diffCaptures
    // must not throw "values is not iterable" on them. See REC 8.
    const onDiskState: SerializedState = {
      graph: {
        nodes: {},
        incomingEdgesIndex: [],
        nodeByBaseName: [],
        unresolvedLinksIndex: [],
      },
      roots: { folderTree: [] }, // no `loaded`
      // no `collapseSet`
      selection: [],
      layout: { positions: [] },
      meta: { schemaVersion: 1, revision: 1 },
    }
    const snapshot: Snapshot = {
      state: onDiskState,
      cyDump: null,
      focused: null,
      selection: [],
      zoom: null,
      pan: null,
      timestamp: '2026-04-19T00:00:00.000Z',
    }

    expect(() => diffCaptures(snapshot, snapshot)).not.toThrow()
    expect(diffCaptures(snapshot, snapshot)).toEqual({ changed: [] })
  })

  it('reports viewport changes via top-level zoom and pan, not cyDump', () => {
    const before = makeSnapshot([], 10, '2026-04-19T00:00:00.000Z')
    const after: Snapshot = {
      ...makeSnapshot([], 10, '2026-04-19T00:00:05.000Z'),
      cyDump: {
        ...before.cyDump!,
        viewport: { zoom: 2, pan: { x: 50, y: -10 } },
      },
      zoom: 2,
      pan: { x: 50, y: -10 },
    }

    expect(diffCaptures(before, after)).toEqual({ changed: ['zoom', 'pan'] })
  })
})

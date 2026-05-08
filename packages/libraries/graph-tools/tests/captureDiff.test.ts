import { describe, expect, it } from 'vitest'
import type { SerializedState } from '@vt/graph-state'
import { diffCaptures, type Snapshot } from '../src/debug/captureDiff'

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
      loaded: ['/tmp/vault'],
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

import type { SerializedState } from '@vt/graph-state'
import type { CyDump } from './cyStateShape'

export type FocusedElement = {
  tag: string
  id?: string
  role?: string
  dataNodeId?: string
}

export type Snapshot = {
  state: SerializedState
  cyDump: CyDump | null
  focused: FocusedElement | null
  selection: string[]
  zoom: number | null
  pan: { x: number; y: number } | null
  timestamp: string
}

export type SnapshotDiff = {
  changed: Array<'state' | 'cyDump' | 'focused' | 'selection' | 'zoom' | 'pan'>
}

function sortStrings(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function stripSelectionClasses(classes: readonly string[]): string[] {
  return sortStrings(classes.filter(name => name !== 'selected'))
}

function normalizeState(state: SerializedState): unknown {
  return {
    graph: state.graph,
    roots: {
      loaded: sortStrings(state.roots.loaded),
      folderTree: state.roots.folderTree,
    },
    collapseSet: sortStrings(state.collapseSet),
    layout: {
      positions: [...state.layout.positions].sort(([left], [right]) => left.localeCompare(right)),
      ...(state.layout.fit !== undefined ? { fit: state.layout.fit } : {}),
    },
    // Revision and mutatedAt change on every live-state read; selection/viewport also have
    // dedicated top-level fields. Dropping them keeps the diff signal load-bearing.
    meta: {
      schemaVersion: state.meta.schemaVersion,
    },
    selection: [],
  }
}

function normalizeCyDump(cyDump: CyDump | null): unknown {
  if (!cyDump) return null

  return {
    nodes: [...cyDump.nodes]
      .map(node => ({
        id: node.id,
        classes: stripSelectionClasses(node.classes),
        position: node.position,
        visible: node.visible,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    edges: [...cyDump.edges]
      .map(edge => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        classes: sortStrings(edge.classes),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  }
}

function stableJson(value: unknown): string {
  return JSON.stringify(value)
}

export function diffCaptures(a: Snapshot, b: Snapshot): SnapshotDiff {
  const changed: SnapshotDiff['changed'] = []
  const comparableA = {
    state: normalizeState(a.state),
    cyDump: normalizeCyDump(a.cyDump),
    focused: a.focused,
    selection: sortStrings(a.selection),
    zoom: a.zoom,
    pan: a.pan,
  }
  const comparableB = {
    state: normalizeState(b.state),
    cyDump: normalizeCyDump(b.cyDump),
    focused: b.focused,
    selection: sortStrings(b.selection),
    zoom: b.zoom,
    pan: b.pan,
  }

  for (const field of ['state', 'cyDump', 'focused', 'selection', 'zoom', 'pan'] as const) {
    if (stableJson(comparableA[field]) !== stableJson(comparableB[field])) {
      changed.push(field)
    }
  }

  // timestamp is capture metadata, not app state. Including it would make every diff noisy.
  return { changed }
}

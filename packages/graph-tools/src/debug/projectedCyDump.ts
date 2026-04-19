import { project, type State } from '@vt/graph-state'
import type { CyDump } from './cyStateShape'

export function projectStateToCyDump(state: State): CyDump {
  const spec = project(state)
  return {
    nodes: spec.nodes.map((node) => ({
      id: node.id,
      classes: [...(node.classes ?? [])],
      position: node.position ?? { x: 0, y: 0 },
      visible: true,
    })),
    edges: spec.edges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      classes: [...(edge.classes ?? [])],
    })),
    viewport: {
      zoom: state.layout.zoom ?? 1,
      pan: state.layout.pan ?? { x: 0, y: 0 },
    },
    selection: [...state.selection].sort((left, right) => left.localeCompare(right)),
  }
}

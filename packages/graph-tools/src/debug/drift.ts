import type { GraphNode } from '@vt/graph-model'
import type { State } from '@vt/graph-state'
import type { CyDump, CyDumpEdge, CyDumpNode } from './cyStateShape'

export type Divergence =
  | { equal: true }
  | {
      equal: false
      missingInA: readonly string[]
      missingInB: readonly string[]
      differing: ReadonlyArray<{ id: string; fields: readonly string[] }>
    }

export type DriftReport = {
  dataVsProjection: Divergence
  projectionVsRendered: Divergence
  nodeContentStale: ReadonlyArray<{ id: string; mainLen: number; fsLen: number }>
}

export type FsContentById = Readonly<Record<string, string | null>>

export type DriftData = State & {
  readonly fsContentById?: FsContentById
}

export type ComputeDriftOptions = {
  readonly deep?: boolean
}

const FLOAT_TOLERANCE = 0.01

function sortStrings(values: readonly string[]): readonly string[] {
  return [...values].sort((left, right) => left.localeCompare(right))
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false
  const sortedLeft = sortStrings(left)
  const sortedRight = sortStrings(right)
  return sortedLeft.every((value, index) => value === sortedRight[index])
}

function sameNumber(left: number, right: number): boolean {
  return Math.abs(left - right) < FLOAT_TOLERANCE
}

function edgeKey(edgeId: string): string {
  return `edge:${edgeId}`
}

function buildDataCyDump(data: State): CyDump {
  const nodeEntries = Object.entries(data.graph.nodes) as Array<[string, GraphNode]>
  const nodes: CyDumpNode[] = nodeEntries
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, node]) => ({
      id,
      classes: [
        ...(data.selection.has(id) ? ['selected'] : []),
        ...(node.nodeUIMetadata.isContextNode === true ? ['context-node'] : []),
      ],
      position: data.layout.positions.get(id) ?? { x: 0, y: 0 },
      visible: true,
    }))

  const seenEdges = new Set<string>()
  const edges: CyDumpEdge[] = []
  const sources = [...nodeEntries].sort(([left], [right]) => left.localeCompare(right))
  for (const [sourceId, node] of sources) {
    const outgoing = [...node.outgoingEdges]
      .sort((left, right) => left.targetId.localeCompare(right.targetId) || left.label.localeCompare(right.label))
    for (const edge of outgoing) {
      const id = `${sourceId}->${edge.targetId}`
      if (seenEdges.has(id)) continue
      seenEdges.add(id)
      edges.push({
        id,
        source: sourceId,
        target: edge.targetId,
        classes: [],
      })
    }
  }

  return {
    nodes,
    edges,
    viewport: {
      zoom: data.layout.zoom ?? 1,
      pan: data.layout.pan ?? { x: 0, y: 0 },
    },
    selection: [...data.selection].sort((left, right) => left.localeCompare(right)),
  }
}

function compareNode(left: CyDumpNode, right: CyDumpNode): readonly string[] {
  const fields: string[] = []
  if (!sameStrings(left.classes, right.classes)) fields.push('classes')
  if (
    !sameNumber(left.position.x, right.position.x)
    || !sameNumber(left.position.y, right.position.y)
  ) {
    fields.push('position')
  }
  if (left.visible !== right.visible) fields.push('visible')
  return fields
}

function compareEdge(left: CyDumpEdge, right: CyDumpEdge): readonly string[] {
  const fields: string[] = []
  if (left.source !== right.source) fields.push('source')
  if (left.target !== right.target) fields.push('target')
  if (!sameStrings(left.classes, right.classes)) fields.push('classes')
  return fields
}

function compareCyDump(a: CyDump, b: CyDump): Divergence {
  const missingInA: string[] = []
  const missingInB: string[] = []
  const differing: Array<{ id: string; fields: readonly string[] }> = []

  const aNodes = new Map(a.nodes.map((node) => [node.id, node] as const))
  const bNodes = new Map(b.nodes.map((node) => [node.id, node] as const))
  const nodeIds = sortStrings([...new Set([...aNodes.keys(), ...bNodes.keys()])])
  for (const nodeId of nodeIds) {
    const left = aNodes.get(nodeId)
    const right = bNodes.get(nodeId)
    if (!left) {
      missingInA.push(nodeId)
      continue
    }
    if (!right) {
      missingInB.push(nodeId)
      continue
    }
    const fields = compareNode(left, right)
    if (fields.length > 0) differing.push({ id: nodeId, fields })
  }

  const aEdges = new Map(a.edges.map((edge) => [edge.id, edge] as const))
  const bEdges = new Map(b.edges.map((edge) => [edge.id, edge] as const))
  const edgeIds = sortStrings([...new Set([...aEdges.keys(), ...bEdges.keys()])])
  for (const edgeId of edgeIds) {
    const left = aEdges.get(edgeId)
    const right = bEdges.get(edgeId)
    if (!left) {
      missingInA.push(edgeKey(edgeId))
      continue
    }
    if (!right) {
      missingInB.push(edgeKey(edgeId))
      continue
    }
    const fields = compareEdge(left, right)
    if (fields.length > 0) differing.push({ id: edgeKey(edgeId), fields })
  }

  const viewportFields: string[] = []
  if (!sameNumber(a.viewport.zoom, b.viewport.zoom)) viewportFields.push('zoom')
  if (
    !sameNumber(a.viewport.pan.x, b.viewport.pan.x)
    || !sameNumber(a.viewport.pan.y, b.viewport.pan.y)
  ) {
    viewportFields.push('pan')
  }
  if (viewportFields.length > 0) differing.push({ id: '__viewport__', fields: viewportFields })

  if (!sameStrings(a.selection, b.selection)) {
    differing.push({ id: '__selection__', fields: ['items'] })
  }

  if (missingInA.length === 0 && missingInB.length === 0 && differing.length === 0) {
    return { equal: true }
  }

  return {
    equal: false,
    missingInA,
    missingInB,
    differing,
  }
}

function computeNodeContentStale(
  data: DriftData,
  opts: ComputeDriftOptions,
): ReadonlyArray<{ id: string; mainLen: number; fsLen: number }> {
  const stale: Array<{ id: string; mainLen: number; fsLen: number }> = []
  const nodeIds = Object.keys(data.graph.nodes).sort((left, right) => left.localeCompare(right))

  for (const nodeId of nodeIds) {
    const node = data.graph.nodes[nodeId]
    const mainContent = node.contentWithoutYamlOrLinks
    const fsContent = data.fsContentById && Object.prototype.hasOwnProperty.call(data.fsContentById, nodeId)
      ? data.fsContentById[nodeId]
      : mainContent
    const fsLen = fsContent === null ? -1 : fsContent.length
    const matches = opts.deep
      ? fsContent !== null && fsContent === mainContent
      : fsLen === mainContent.length

    if (!matches) {
      stale.push({
        id: nodeId,
        mainLen: mainContent.length,
        fsLen,
      })
    }
  }

  return stale
}

export function computeDrift(
  data: DriftData,
  projected: CyDump,
  rendered: CyDump,
  opts: ComputeDriftOptions = {},
): DriftReport {
  const dataCyDump = buildDataCyDump(data)
  return {
    dataVsProjection: compareCyDump(dataCyDump, projected),
    projectionVsRendered: compareCyDump(projected, rendered),
    nodeContentStale: computeNodeContentStale(data, opts),
  }
}

// Pure types and parser for cytoscape state dumps.
// Consumed by commands/cyDump.ts (CLI shell) and vtDebugHelper.ts (renderer).

export type CyDumpNode = {
  id: string
  classes: string[]
  position: { x: number; y: number }
  visible: boolean
}

export type CyDumpEdge = {
  id: string
  source: string
  target: string
  classes: string[]
}

export type CyDump = {
  nodes: CyDumpNode[]
  edges: CyDumpEdge[]
  viewport: { zoom: number; pan: { x: number; y: number } }
  selection: string[]
}

export type CySource = 'data' | 'projected' | 'rendered' | 'all'

function splitClasses(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return []
  return raw.trim().split(/\s+/)
}

function safeNum(v: unknown, fallback = 0): number {
  return typeof v === 'number' && isFinite(v) ? v : fallback
}

// Parse raw cy.json() output (unknown shape from CDP evaluate) into typed CyDump.
// The only caller that uses CyDump from the CLI side; the renderer builds it directly.
export function parseCyDump(raw: unknown): CyDump {
  const r = raw as Record<string, unknown>
  const els = (r.elements as Record<string, unknown>) ?? {}
  const rawNodes = Array.isArray(els.nodes) ? (els.nodes as Record<string, unknown>[]) : []
  const rawEdges = Array.isArray(els.edges) ? (els.edges as Record<string, unknown>[]) : []
  const pan = (r.pan as Record<string, unknown>) ?? {}

  const nodes: CyDumpNode[] = rawNodes.map(n => {
    const data = (n.data as Record<string, unknown>) ?? {}
    const pos = (n.position as Record<string, unknown>) ?? {}
    return {
      id: String(data.id ?? ''),
      classes: splitClasses(n.classes),
      position: { x: safeNum(pos.x), y: safeNum(pos.y) },
      // cy.json() doesn't surface visibility; default true; callers override if needed
      visible: n.visible !== false,
    }
  })

  const edges: CyDumpEdge[] = rawEdges.map(e => {
    const data = (e.data as Record<string, unknown>) ?? {}
    return {
      id: String(data.id ?? ''),
      source: String(data.source ?? ''),
      target: String(data.target ?? ''),
      classes: splitClasses(e.classes),
    }
  })

  return {
    nodes,
    edges,
    viewport: {
      zoom: safeNum(r.zoom, 1),
      pan: { x: safeNum(pan.x), y: safeNum(pan.y) },
    },
    selection: nodes.filter(n => n.classes.includes('selected')).map(n => n.id),
  }
}

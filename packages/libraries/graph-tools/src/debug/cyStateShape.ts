// Pure types and parser for cytoscape state dumps.
// Consumed by commands/cyDump.ts (CLI shell) and vtDebugHelper.ts (renderer).

export type CyNodeData = {
  id: string
  label?: string
  folderLabel?: string
  parent?: string
  isFolderNode?: boolean
  collapsed?: boolean
}

export type CyDumpNode = {
  id: string
  classes: string[]
  data?: CyNodeData
  position: { x: number; y: number }
  visible: boolean
  width?: number
  height?: number
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

function safeOptionalNum(v: unknown): number | undefined {
  return typeof v === 'number' && isFinite(v) ? v : undefined
}

function parseNodeData(raw: unknown, fallbackId: string): CyNodeData | undefined {
  if (typeof raw !== 'object' || raw === null) {
    // Raw input had no `data` key — don't synthesise one.
    return undefined
  }

  const data = raw as Record<string, unknown>
  return {
    id: String(data.id ?? fallbackId),
    ...(typeof data.label === 'string' ? { label: data.label } : {}),
    ...(typeof data.folderLabel === 'string' ? { folderLabel: data.folderLabel } : {}),
    ...(typeof data.parent === 'string' ? { parent: data.parent } : {}),
    ...(typeof data.isFolderNode === 'boolean' ? { isFolderNode: data.isFolderNode } : {}),
    ...(typeof data.collapsed === 'boolean' ? { collapsed: data.collapsed } : {}),
  }
}

function parseStructuredCyDump(raw: Record<string, unknown>): CyDump {
  const rawNodes = Array.isArray(raw.nodes) ? (raw.nodes as Record<string, unknown>[]) : []
  const rawEdges = Array.isArray(raw.edges) ? (raw.edges as Record<string, unknown>[]) : []
  const viewport = (raw.viewport as Record<string, unknown>) ?? {}
  const pan = (viewport.pan as Record<string, unknown>) ?? {}

  return {
    nodes: rawNodes.map(n => {
      const data = (n.data as Record<string, unknown> | undefined) ?? {}
      const id = String(n.id ?? data.id ?? '')
      const width = safeOptionalNum(n.width)
      const height = safeOptionalNum(n.height)

      const parsedData = parseNodeData(n.data, id)
      return {
        id,
        classes: Array.isArray(n.classes) ? n.classes.map(String) : splitClasses(n.classes),
        ...(parsedData !== undefined ? { data: parsedData } : {}),
        position: {
          x: safeNum((n.position as Record<string, unknown> | undefined)?.x),
          y: safeNum((n.position as Record<string, unknown> | undefined)?.y),
        },
        visible: n.visible !== false,
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
      }
    }),
    edges: rawEdges.map(e => ({
      id: String(e.id ?? ''),
      source: String(e.source ?? ''),
      target: String(e.target ?? ''),
      classes: Array.isArray(e.classes) ? e.classes.map(String) : splitClasses(e.classes),
    })),
    viewport: {
      zoom: safeNum(viewport.zoom, 1),
      pan: { x: safeNum(pan.x), y: safeNum(pan.y) },
    },
    selection: Array.isArray(raw.selection) ? raw.selection.map(String) : [],
  }
}

// Parse raw cy.json() output (unknown shape from CDP evaluate) into typed CyDump.
// The only caller that uses CyDump from the CLI side; the renderer builds it directly.
export function parseCyDump(raw: unknown): CyDump {
  const r = raw as Record<string, unknown>

  if (Array.isArray(r.nodes) && Array.isArray(r.edges) && typeof r.viewport === 'object' && r.viewport !== null) {
    return parseStructuredCyDump(r)
  }

  const els = (r.elements as Record<string, unknown>) ?? {}
  const rawNodes = Array.isArray(els.nodes) ? (els.nodes as Record<string, unknown>[]) : []
  const rawEdges = Array.isArray(els.edges) ? (els.edges as Record<string, unknown>[]) : []
  const pan = (r.pan as Record<string, unknown>) ?? {}

  const nodes: CyDumpNode[] = rawNodes.map(n => {
    const data = (n.data as Record<string, unknown>) ?? {}
    const pos = (n.position as Record<string, unknown>) ?? {}
    const id = String(data.id ?? '')
    const width = safeOptionalNum(n.width) ?? safeOptionalNum(data.width)
    const height = safeOptionalNum(n.height) ?? safeOptionalNum(data.height)
    const parsedData = parseNodeData(n.data, id)
    return {
      id,
      classes: splitClasses(n.classes),
      ...(parsedData !== undefined ? { data: parsedData } : {}),
      position: { x: safeNum(pos.x), y: safeNum(pos.y) },
      // cy.json() doesn't surface visibility; default true; callers override if needed
      visible: n.visible !== false,
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
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

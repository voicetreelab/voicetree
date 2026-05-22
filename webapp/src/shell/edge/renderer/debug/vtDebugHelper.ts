// Renderer-side cy() dump helper for window.__vtDebug__.
// Called via page.evaluate(() => window.__vtDebug__.cy()) from the CLI.
// Installed by main.tsx after the ring buffer hooks (consoleBuffer.ts).

import { getCyInstance, isCyInitialized } from '@/shell/edge/UI-edge/state/controllers/cytoscape-state'
import type { Core } from 'cytoscape'

type CyNodeData = {
  id: string
  label?: string
  folderLabel?: string
  parent?: string
  isFolderNode?: boolean
  collapsed?: boolean
}

type CyDumpNode = {
  id: string
  classes: string[]
  data: CyNodeData
  position: { x: number; y: number }
  visible: boolean
  width?: number
  height?: number
}
type CyDumpEdge = { id: string; source: string; target: string; classes: string[] }

export type CyDump = {
  nodes: CyDumpNode[]
  edges: CyDumpEdge[]
  viewport: { zoom: number; pan: { x: number; y: number } }
  selection: string[]
}

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

// Pure transformation of a live cytoscape Core into a serializable CyDump.
export function dumpCy(cy: Core): CyDump {
  const json: Record<string, unknown> = cy.json() as Record<string, unknown>
  const els: Record<string, unknown> = (json.elements as Record<string, unknown>) ?? {}
  const rawNodes: Record<string, unknown>[] = Array.isArray(els.nodes) ? (els.nodes as Record<string, unknown>[]) : []
  const rawEdges: Record<string, unknown>[] = Array.isArray(els.edges) ? (els.edges as Record<string, unknown>[]) : []
  const pan: Record<string, unknown> = (json.pan as Record<string, unknown>) ?? {}

  const nodes: CyDumpNode[] = rawNodes.map(n => {
    const data: Record<string, unknown> = (n.data as Record<string, unknown>) ?? {}
    const pos: Record<string, unknown> = (n.position as Record<string, unknown>) ?? {}
    const id: string = String(data.id ?? '')
    const element = cy.getElementById(id)
    const width = safeOptionalNum(element.width())
    const height = safeOptionalNum(element.height())
    return {
      id,
      classes: splitClasses(n.classes),
      data: {
        id,
        ...(typeof data.label === 'string' ? { label: data.label } : {}),
        ...(typeof data.folderLabel === 'string' ? { folderLabel: data.folderLabel } : {}),
        ...(typeof data.parent === 'string' ? { parent: data.parent } : {}),
        ...(typeof data.isFolderNode === 'boolean' ? { isFolderNode: data.isFolderNode } : {}),
        ...(typeof data.collapsed === 'boolean' ? { collapsed: data.collapsed } : {}),
      },
      position: { x: safeNum(pos.x), y: safeNum(pos.y) },
      visible: !element.hidden(),
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
    }
  })

  const edges: CyDumpEdge[] = rawEdges.map(e => {
    const data: Record<string, unknown> = (e.data as Record<string, unknown>) ?? {}
    return {
      id: String(data.id ?? ''),
      source: String(data.source ?? ''),
      target: String(data.target ?? ''),
      classes: splitClasses(e.classes),
    }
  })

  const selection: string[] = cy.nodes(':selected').map(n => n.id())

  return {
    nodes,
    edges,
    viewport: { zoom: safeNum(json.zoom, 1), pan: { x: safeNum(pan.x), y: safeNum(pan.y) } },
    selection,
  }
}

// Returns the current cy dump, or null if cy isn't initialized yet.
export function tryDumpCy(): CyDump | null {
  if (!isCyInitialized()) return null
  return dumpCy(getCyInstance())
}

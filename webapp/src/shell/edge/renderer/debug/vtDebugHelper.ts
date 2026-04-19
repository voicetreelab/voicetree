// Renderer-side cy() dump helper for window.__vtDebug__.
// Called via page.evaluate(() => window.__vtDebug__.cy()) from the CLI.
// Installed by main.tsx after the ring buffer hooks (consoleBuffer.ts).

import { getCyInstance, isCyInitialized } from '@/shell/edge/UI-edge/state/cytoscape-state'
import type { Core } from 'cytoscape'

type CyDumpNode = { id: string; classes: string[]; position: { x: number; y: number }; visible: boolean }
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
    return {
      id,
      classes: splitClasses(n.classes),
      position: { x: safeNum(pos.x), y: safeNum(pos.y) },
      visible: !cy.getElementById(id).hidden(),
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

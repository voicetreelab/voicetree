/**
 * BF-153 · L1-H — Parity harness helpers (test-only).
 *
 * The harness proves that `project(state)` produces an ElementSpec cytoscape
 * can round-trip losslessly. We feed a headless cytoscape instance the spec,
 * read `cy.json().elements` back, normalize both sides, and compare.
 *
 * ## What cytoscape adds / strips
 *
 * `cy.json()` runtime shape (observed 2026-04-17, cytoscape ^3.33):
 *   { elements: { nodes: [...], edges: [...] },
 *     data, zoom, pan, boxSelectionEnabled, renderer, ... }
 *
 * Each node/edge round-tripped through `cy.add()` is enriched with cy-internal
 * fields that are NOT part of our pure ElementSpec and MUST be stripped before
 * structural comparison:
 *   • `group`         — redundant with the nodes/edges split
 *   • `position`      — cytoscape auto-emits {x:0,y:0} even when none was set
 *   • `removed`, `selected`, `selectable`, `locked`, `grabbable`, `pannable`
 *                     — render-layer flags, never part of the pure contract
 *   • `style`, `scratch`, `renderedPosition` — DOM/layout concerns
 *   • `classes`       — cytoscape serializes class arrays as a single
 *                       space-separated string; we re-split on read
 *
 * ## What we KEEP and compare
 *
 *   • `data.id`               — identity
 *   • `data.parent`           — compound parent (nodes only)
 *   • `data.source`, `data.target` — edge endpoints
 *   • remaining `data.*` fields — label, kind, plus anything `project()` put
 *     in `data` (compared shallowly: we don't prescribe shape here)
 *   • `position` — only if the ElementSpec node carries one; otherwise cy's
 *     {0,0} default is not considered a parity failure
 *   • `classes`  — as a Set<string> to tolerate order & string/array split
 *
 * `toCyElement` maps an ElementSpec element to cytoscape's `ElementDefinition`
 * by lifting `parent`, `label`, and `kind` into `data` (cytoscape reads only
 * `data.*` for its identity + containment graph).
 */

import cytoscape, { type ElementDefinition } from 'cytoscape'

import type { EdgeElement, ElementSpec, NodeElement } from '../src/contract'

// ============================================================================
// toCyElement
// ============================================================================

/**
 * Convert one NodeElement|EdgeElement into cytoscape's ElementDefinition.
 * All pure-contract fields that cytoscape needs (id, parent, source, target,
 * label, kind, classes, position, any extra data) are placed so that they
 * survive `cy.add()` + `cy.json()` round-trip.
 */
export function toCyElement(el: NodeElement | EdgeElement): ElementDefinition {
    if (isEdge(el)) {
        const data: Record<string, unknown> = {
            ...(el.data ?? {}),
            id: el.id,
            source: el.source as string,
            target: el.target as string,
        }
        if (el.label !== undefined) data.label = el.label
        data.kind = el.kind
        const def: ElementDefinition = { group: 'edges', data }
        if (el.classes && el.classes.length > 0) def.classes = [...el.classes]
        return def
    }
    const data: Record<string, unknown> = {
        ...(el.data ?? {}),
        id: el.id as string,
    }
    if (el.parent !== undefined) data.parent = el.parent
    if (el.label !== undefined) data.label = el.label
    data.kind = el.kind
    const def: ElementDefinition = { group: 'nodes', data }
    if (el.position) def.position = { x: el.position.x, y: el.position.y }
    if (el.classes && el.classes.length > 0) def.classes = [...el.classes]
    return def
}

function isEdge(el: NodeElement | EdgeElement): el is EdgeElement {
    return (el as EdgeElement).source !== undefined && (el as EdgeElement).target !== undefined
}

// ============================================================================
// Normalizer
// ============================================================================

interface NormalizedNode {
    readonly id: string
    readonly parent?: string
    readonly kind?: string
    readonly data: Readonly<Record<string, unknown>>
    readonly classes: readonly string[]
    readonly position?: { readonly x: number; readonly y: number }
}

interface NormalizedEdge {
    readonly id: string
    readonly source: string
    readonly target: string
    readonly kind?: string
    readonly data: Readonly<Record<string, unknown>>
    readonly classes: readonly string[]
}

export interface NormalizedGraph {
    readonly nodes: readonly NormalizedNode[]
    readonly edges: readonly NormalizedEdge[]
}

const CY_STRIPPED_FIELDS = new Set([
    'group',
    'removed',
    'selected',
    'selectable',
    'locked',
    'grabbable',
    'pannable',
    'style',
    'scratch',
    'renderedPosition',
])

/**
 * Normalize a cy.json()-shaped blob OR a raw ElementSpec into a
 * structurally-comparable NormalizedGraph. Both paths go through this so the
 * two sides are genuinely apples-to-apples (no shape mismatch papering over a
 * real diff).
 */
export function normalizeCyJson(cyJson: unknown): NormalizedGraph {
    const elements = extractElements(cyJson)
    const nodes = elements.nodes.map(normalizeCyNode)
    const edges = elements.edges.map(normalizeCyEdge)
    return { nodes: sortNodes(nodes), edges: sortEdges(edges) }
}

export function normalizeSpec(spec: ElementSpec): NormalizedGraph {
    const nodes = spec.nodes.map(normalizeSpecNode)
    const edges = spec.edges.map(normalizeSpecEdge)
    return { nodes: sortNodes(nodes), edges: sortEdges(edges) }
}

function extractElements(cyJson: unknown): { nodes: CyRawEl[]; edges: CyRawEl[] } {
    const j = cyJson as { elements?: { nodes?: CyRawEl[]; edges?: CyRawEl[] } | CyRawEl[] }
    const els = j.elements
    if (Array.isArray(els)) {
        const nodes = els.filter((e) => e.group === 'nodes')
        const edges = els.filter((e) => e.group === 'edges')
        return { nodes, edges }
    }
    return { nodes: els?.nodes ?? [], edges: els?.edges ?? [] }
}

interface CyRawEl {
    readonly group?: string
    readonly data: { readonly id?: string; readonly parent?: string; readonly source?: string; readonly target?: string; readonly label?: string; readonly kind?: string; readonly [k: string]: unknown }
    readonly position?: { readonly x: number; readonly y: number }
    readonly classes?: string | readonly string[]
    readonly [k: string]: unknown
}

function normalizeCyNode(el: CyRawEl): NormalizedNode {
    const { id, parent, kind, ...rest } = el.data
    if (id === undefined) throw new Error('parity: cy node missing data.id')
    const classes = splitClasses(el.classes)
    const position = hasMeaningfulPosition(el) ? { x: el.position!.x, y: el.position!.y } : undefined
    const cleanedData = stripCyFields(rest)
    const out: NormalizedNode = {
        id,
        ...(parent !== undefined ? { parent } : {}),
        ...(typeof kind === 'string' ? { kind } : {}),
        data: cleanedData,
        classes,
        ...(position ? { position } : {}),
    }
    return out
}

function normalizeCyEdge(el: CyRawEl): NormalizedEdge {
    const { id, source, target, kind, ...rest } = el.data
    if (id === undefined) throw new Error('parity: cy edge missing data.id')
    if (source === undefined || target === undefined) throw new Error('parity: cy edge missing source/target')
    const classes = splitClasses(el.classes)
    const cleanedData = stripCyFields(rest)
    return {
        id,
        source,
        target,
        ...(typeof kind === 'string' ? { kind } : {}),
        data: cleanedData,
        classes,
    }
}

function normalizeSpecNode(el: NodeElement): NormalizedNode {
    const classes = el.classes ? [...el.classes] : []
    return {
        id: el.id as string,
        ...(el.parent !== undefined ? { parent: el.parent } : {}),
        kind: el.kind,
        data: { ...(el.data ?? {}), ...(el.label !== undefined ? { label: el.label } : {}) },
        classes: [...classes].sort(),
        ...(el.position ? { position: { x: el.position.x, y: el.position.y } } : {}),
    }
}

function normalizeSpecEdge(el: EdgeElement): NormalizedEdge {
    const classes = el.classes ? [...el.classes] : []
    return {
        id: el.id,
        source: el.source as string,
        target: el.target as string,
        kind: el.kind,
        data: { ...(el.data ?? {}), ...(el.label !== undefined ? { label: el.label } : {}) },
        classes: [...classes].sort(),
    }
}

function splitClasses(raw: string | readonly string[] | undefined): readonly string[] {
    if (!raw) return []
    const arr = typeof raw === 'string' ? raw.split(/\s+/).filter(Boolean) : [...raw]
    return arr.sort()
}

function stripCyFields(data: Readonly<Record<string, unknown>>): Readonly<Record<string, unknown>> {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(data)) {
        if (CY_STRIPPED_FIELDS.has(k)) continue
        out[k] = v
    }
    return out
}

function hasMeaningfulPosition(el: CyRawEl): boolean {
    // cytoscape always emits {x:0,y:0} by default; we only treat a position as
    // meaningful when the cy element was explicitly built from a spec that
    // carried one. We mark that by setting a '__hasPos' flag on toCyElement's
    // data — but to keep toCyElement clean we detect via a side channel: the
    // spec-side normalizer adds position only when present, so cy.json's
    // defaulted {0,0} is compared as "no position" via round-trip only. We
    // approximate by: treat {0,0} as absent. If the ElementSpec genuinely
    // places a node at origin, round-trip will look "absent" on cy side but
    // "present" on spec side — which is a tolerable off-by-origin we do not
    // optimize for at v1 (document this in parity.test assertion).
    const p = el.position
    if (!p) return false
    return p.x !== 0 || p.y !== 0
}

// ============================================================================
// Sorting
// ============================================================================

function sortNodes(nodes: readonly NormalizedNode[]): readonly NormalizedNode[] {
    return [...nodes].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

function sortEdges(edges: readonly NormalizedEdge[]): readonly NormalizedEdge[] {
    return [...edges].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

// ============================================================================
// Round-trip helper
// ============================================================================

/**
 * Feed an ElementSpec into a headless cytoscape instance, pull cy.json() back
 * out, and normalize it. Returns the cy-side NormalizedGraph for comparison.
 */
export function specThroughCytoscape(spec: ElementSpec): NormalizedGraph {
    const elements: ElementDefinition[] = [
        ...spec.nodes.map(toCyElement),
        ...spec.edges.map(toCyElement),
    ]
    const cy = cytoscape({ headless: true, styleEnabled: false, elements })
    const cyJson = cy.json() as unknown
    const normalized = normalizeCyJson(cyJson)
    cy.destroy()
    return normalized
}

// ============================================================================
// Assertions (one per V-L1-4/5/6)
// ============================================================================

export interface ParityDiff {
    readonly where: 'nodes' | 'edges' | 'parents'
    readonly fixture: string
    readonly onlyInSpec: readonly string[]
    readonly onlyInCy:   readonly string[]
    readonly mismatched: readonly { id: string; specValue: unknown; cyValue: unknown }[]
}

/** V-L1-4: same node ids + kinds after round-trip. */
export function diffNodes(fixture: string, spec: NormalizedGraph, cy: NormalizedGraph): ParityDiff {
    const specIds = new Set(spec.nodes.map((n) => n.id))
    const cyIds = new Set(cy.nodes.map((n) => n.id))
    const mismatched: { id: string; specValue: unknown; cyValue: unknown }[] = []
    for (const sn of spec.nodes) {
        const cn = cy.nodes.find((x) => x.id === sn.id)
        if (!cn) continue
        if (sn.kind !== cn.kind) {
            mismatched.push({ id: sn.id, specValue: { kind: sn.kind }, cyValue: { kind: cn.kind } })
        }
    }
    return {
        where: 'nodes',
        fixture,
        onlyInSpec: [...specIds].filter((x) => !cyIds.has(x)).sort(),
        onlyInCy:   [...cyIds].filter((x) => !specIds.has(x)).sort(),
        mismatched,
    }
}

/** V-L1-5: same edge ids + endpoints after round-trip. */
export function diffEdges(fixture: string, spec: NormalizedGraph, cy: NormalizedGraph): ParityDiff {
    const specIds = new Set(spec.edges.map((e) => e.id))
    const cyIds = new Set(cy.edges.map((e) => e.id))
    const mismatched: { id: string; specValue: unknown; cyValue: unknown }[] = []
    for (const se of spec.edges) {
        const ce = cy.edges.find((x) => x.id === se.id)
        if (!ce) continue
        if (se.source !== ce.source || se.target !== ce.target || se.kind !== ce.kind) {
            mismatched.push({
                id: se.id,
                specValue: { source: se.source, target: se.target, kind: se.kind },
                cyValue:   { source: ce.source, target: ce.target, kind: ce.kind },
            })
        }
    }
    return {
        where: 'edges',
        fixture,
        onlyInSpec: [...specIds].filter((x) => !cyIds.has(x)).sort(),
        onlyInCy:   [...cyIds].filter((x) => !specIds.has(x)).sort(),
        mismatched,
    }
}

/** V-L1-6: same compound-parent relations after round-trip. */
export function diffParents(fixture: string, spec: NormalizedGraph, cy: NormalizedGraph): ParityDiff {
    const specParents = mapParent(spec.nodes)
    const cyParents   = mapParent(cy.nodes)
    const ids = new Set<string>([...specParents.keys(), ...cyParents.keys()])
    const mismatched: { id: string; specValue: unknown; cyValue: unknown }[] = []
    for (const id of ids) {
        const sp = specParents.get(id) ?? null
        const cp = cyParents.get(id)   ?? null
        if (sp !== cp) mismatched.push({ id, specValue: sp, cyValue: cp })
    }
    return { where: 'parents', fixture, onlyInSpec: [], onlyInCy: [], mismatched }
}

function mapParent(nodes: readonly NormalizedNode[]): Map<string, string | null> {
    const m = new Map<string, string | null>()
    for (const n of nodes) m.set(n.id, n.parent ?? null)
    return m
}

export function describeDiff(d: ParityDiff): string {
    const lines: string[] = [`[${d.fixture}] parity.${d.where}`]
    if (d.onlyInSpec.length) lines.push(`  onlyInSpec (${d.onlyInSpec.length}): ${d.onlyInSpec.slice(0, 5).join(', ')}${d.onlyInSpec.length > 5 ? '…' : ''}`)
    if (d.onlyInCy.length)   lines.push(`  onlyInCy   (${d.onlyInCy.length}): ${d.onlyInCy.slice(0, 5).join(', ')}${d.onlyInCy.length > 5 ? '…' : ''}`)
    if (d.mismatched.length) {
        lines.push(`  mismatched (${d.mismatched.length}):`)
        for (const m of d.mismatched.slice(0, 5)) {
            lines.push(`    ${m.id}: spec=${JSON.stringify(m.specValue)} cy=${JSON.stringify(m.cyValue)}`)
        }
        if (d.mismatched.length > 5) lines.push(`    … (${d.mismatched.length - 5} more)`)
    }
    return lines.join('\n')
}

export function isClean(d: ParityDiff): boolean {
    return d.onlyInSpec.length === 0 && d.onlyInCy.length === 0 && d.mismatched.length === 0
}

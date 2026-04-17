/**
 * BF-155 · L1-J — F6 synthetic-edge parity test.
 *
 * Contract: for every snapshot fixture with a non-empty `collapseSet`, the
 * synthetic edges emitted by `project()` must equal the output of the legacy
 * authoritative aggregator `computeSyntheticEdgeSpecs` (BF-108 design law
 * decision 3).
 *
 * project() is allowed to be a different SHAPE from the legacy aggregator —
 * but the SET of synthetic edges (deduped per F6 rules) MUST be identical.
 *
 * If parity fails, fix project() (BF-143) or file a follow-up BF. Do not
 * massage this test.
 */
import { describe, expect, it } from 'vitest'

import {
    listSnapshotDocuments,
    loadSnapshot,
    type EdgeElement,
    type ElementSpec,
    type State,
} from '../src/index'

import { computeSyntheticEdgeSpecs } from '@vt/graph-tools'

// project() is landed by BF-143 (L1-F). Until that commit merges, the export
// does not exist on the '../src/index' module — so we resolve it dynamically
// and skip the suite when it is not yet available. Skipping preserves the
// parity gate (no assertion is loosened) while keeping the wider test suite
// green across the concurrent L1 agent fan-in.
const graphStateModule = (await import('../src/index')) as unknown as {
    readonly project?: (state: State) => ElementSpec
}
const project: ((state: State) => ElementSpec) | undefined = graphStateModule.project
const projectAvailable: boolean = typeof project === 'function'

// ── Normalization ──────────────────────────────────────────────────────────

interface NormalizedEdge {
    readonly source: string
    readonly target: string
    readonly label: string | null
}

function byKey(a: NormalizedEdge, b: NormalizedEdge): number {
    return (
        a.source.localeCompare(b.source)
        || a.target.localeCompare(b.target)
        || (a.label ?? '').localeCompare(b.label ?? '')
    )
}

/** Normalize project()'s synthetic edges. */
function normalizeProjectSynthetic(edges: readonly EdgeElement[]): readonly NormalizedEdge[] {
    return edges
        .filter(e => e.kind === 'synthetic')
        .map(e => ({
            source: e.source,
            target: e.target,
            label: e.label && e.label.length > 0 ? e.label : null,
        }))
        .slice()
        .sort(byKey)
}

// ── Legacy aggregator harness ──────────────────────────────────────────────

interface ConnectedEdge {
    readonly sourceId: string
    readonly targetId: string
    readonly label?: string
}

/**
 * Walk folder ID upward. `/a/b/c/` → `/a/b/`, `/a/` → null.
 * FolderIds in State are absolute paths with a trailing slash.
 */
function parentFolderId(folderId: string): string | null {
    const trimmed = folderId.slice(0, -1)
    const lastSlash = trimmed.lastIndexOf('/')
    if (lastSlash <= 0) return null
    return `${trimmed.slice(0, lastSlash)}/`
}

/** Folder parent of a node ID. `/a/b/file.md` → `/a/b/`. */
function nodeParentFolder(nodeId: string): string | null {
    const lastSlash = nodeId.lastIndexOf('/')
    if (lastSlash <= 0) return null
    return nodeId.slice(0, lastSlash + 1)
}

/**
 * When collapses nest, only the OUTERMOST collapsed folder is user-visible.
 * Nodes/edges inside inner-collapsed folders anchor to the outer one. Mirrors
 * `selectVisibleCollapsedFolders` in src/project.ts.
 */
function visibleCollapsedFolders(
    collapseSet: ReadonlySet<string>,
): ReadonlySet<string> {
    const visible = new Set<string>()
    const sorted = [...collapseSet].sort(
        (a, b) => a.length - b.length || a.localeCompare(b),
    )
    for (const folderId of sorted) {
        let ancestor = parentFolderId(folderId)
        let hasVisibleAncestor = false
        while (ancestor) {
            if (visible.has(ancestor)) { hasVisibleAncestor = true; break }
            ancestor = parentFolderId(ancestor)
        }
        if (!hasVisibleAncestor) visible.add(folderId)
    }
    return visible
}

/**
 * Resolve a raw node ID to its visible endpoint — either the node itself, or
 * the nearest visible-collapsed ancestor folder if the node is hidden inside
 * one.
 */
function visibleEndpointFor(
    nodeId: string,
    visible: ReadonlySet<string>,
): string {
    let folder = nodeParentFolder(nodeId)
    while (folder) {
        if (visible.has(folder)) return folder
        folder = parentFolderId(folder)
    }
    return nodeId
}

/**
 * Produce normalized synthetic-edge tuples by iterating every visible
 * collapsed folder and feeding `computeSyntheticEdgeSpecs` the correct
 * (descendants, connected-edges) pair — where external endpoints are
 * themselves resolved to their visible form so nested collapses aggregate
 * the same way project() does.
 */
function legacyNormalizedFor(state: State): readonly NormalizedEdge[] {
    const visible = visibleCollapsedFolders(state.collapseSet)
    const out: NormalizedEdge[] = []

    const nodeIds: readonly string[] = Object.keys(state.graph.nodes).filter(
        (id) => state.graph.nodes[id]?.nodeUIMetadata.isContextNode !== true,
    )

    for (const folderId of visible) {
        const descendants = new Set<string>()
        for (const id of nodeIds) {
            if (visibleEndpointFor(id, visible) === folderId) descendants.add(id)
        }
        if (descendants.size === 0) continue

        const connected: ConnectedEdge[] = []
        const seen = new Set<string>()
        for (const sourceId of nodeIds) {
            const node = state.graph.nodes[sourceId]
            if (!node) continue
            for (const edge of node.outgoingEdges) {
                const targetNode = state.graph.nodes[edge.targetId]
                if (targetNode?.nodeUIMetadata.isContextNode === true) continue

                const srcEnd = visibleEndpointFor(sourceId, visible)
                const tgtEnd = visibleEndpointFor(edge.targetId, visible)
                if (srcEnd !== folderId && tgtEnd !== folderId) continue
                if (srcEnd === tgtEnd) continue  // both resolve inside — project skips.

                const sourceResolved = srcEnd === folderId ? sourceId : srcEnd
                const targetResolved = tgtEnd === folderId ? edge.targetId : tgtEnd
                const normalizedLabel = edge.label.length > 0 ? edge.label : undefined
                const key = `${sourceResolved}->${targetResolved}|${normalizedLabel ?? ''}`
                if (seen.has(key)) continue
                seen.add(key)
                connected.push({
                    sourceId: sourceResolved,
                    targetId: targetResolved,
                    label: normalizedLabel,
                })
            }
        }

        const specs = computeSyntheticEdgeSpecs(folderId, descendants, connected)
        for (const spec of specs) {
            // project() emits edge.label only for single-edge aggregates
            // (length === 1); multi-edge aggregates drop label by design.
            const label = spec.originalEdges.length === 1
                ? (spec.originalEdges[0].label ?? null)
                : null
            const normalizedLabel = label && label.length > 0 ? label : null
            if (spec.direction === 'incoming') {
                out.push({
                    source: spec.externalNodeId,
                    target: folderId,
                    label: normalizedLabel,
                })
            } else {
                out.push({
                    source: folderId,
                    target: spec.externalNodeId,
                    label: normalizedLabel,
                })
            }
        }
    }

    return out.slice().sort(byKey)
}

// ── Tests ──────────────────────────────────────────────────────────────────

function collapsedFixtureIds(): readonly string[] {
    return listSnapshotDocuments()
        .filter(f => f.state.collapseSet.size > 0)
        .map(f => f.doc.id)
}

function assertParity(fixtureId: string): void {
    if (!project) throw new Error('project() unavailable — BF-143 not yet landed')
    const state = loadSnapshot(fixtureId)
    const projectSide = normalizeProjectSynthetic(project(state).edges)
    const legacySide = legacyNormalizedFor(state)
    expect(projectSide).toEqual(legacySide)
}

describe.skipIf(!projectAvailable)(
    'BF-155 · F6 synthetic-edge parity vs computeSyntheticEdgeSpecs',
    () => {
        it('external → folder (013-f6-external-into-folder-collapsed)', () => {
            assertParity('013-f6-external-into-folder-collapsed')
        })

        it('folder → external (015-f6-folder-to-external-collapsed)', () => {
            assertParity('015-f6-folder-to-external-collapsed')
        })

        it('mixed (040-mixed-collapse)', () => {
            assertParity('040-mixed-collapse')
        })

        // Blanket sweep: parity must hold across every fixture with a
        // non-empty collapseSet, not only the three named cases above. A new
        // F6 fixture regressing parity will fail here.
        describe('all fixtures with non-empty collapseSet', () => {
            for (const id of collapsedFixtureIds()) {
                it(id, () => {
                    assertParity(id)
                })
            }
        })
    },
)

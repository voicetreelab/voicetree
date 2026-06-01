/**
 * Hot Zone C — Surface (d): Disconnected components remain packed after
 * re-projection.
 *
 * Black-box (CLAUDE.md): drives the public surface — `applyPositions`
 * (graph-model) seeds packed positions, then `project` (graph-state) emits
 * the projected graph. We assert on the observable output: bounding boxes
 * of disconnected components in the projected graph do not overlap.
 *
 * Regression intent: prevents regression of `40e328de fix(graph-model):
 * pack disconnected components in applyPositions`. Before the fix, angular
 * seeding placed every disconnected root around the origin, so multiple
 * components stacked on top of each other on initial load. The packing
 * step in `applyPositions` separates them — and the projection step must
 * preserve that separation, since it's only reading positions out of
 * `state.layout.positions`.
 */

import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, it } from 'vitest'

import {
    applyPositions,
    createEmptyGraph,
    createGraph,
    type Graph,
    type GraphNode,
    type NodeIdAndFilePath,
    type Position,
} from '@vt/graph-model'
import { componentsOverlap, type ComponentSubgraph } from '@vt/graph-model/spatial'

import { applyCommand } from '../../src/applyCommand'
import type { ProjectedGraph, ProjectedNode, State } from '../../src/contract'
import { emptyState } from '../../src/emptyState'
import { project } from '../../src/project'

const NODE_W: number = 250
const NODE_H: number = 100

function leaf(id: NodeIdAndFilePath, edges: readonly NodeIdAndFilePath[]): GraphNode {
    return {
        kind: 'leaf',
        absoluteFilePathIsID: id,
        outgoingEdges: edges.map((targetId: NodeIdAndFilePath) => ({ targetId, label: '' })),
        contentWithoutYamlOrLinks: `# ${id}\n`,
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: {},
            isContextNode: false,
        },
    } as GraphNode
}

function multiComponentGraph(numComponents: number, childrenPerRoot: number): Graph {
    const nodes: Record<string, GraphNode> = {}
    for (let c: number = 0; c < numComponents; c++) {
        const rootId: string = `/project/root_${c}.md`
        const childIds: readonly string[] = Array.from(
            { length: childrenPerRoot },
            (_unused: unknown, i: number): string => `/project/c${c}_child_${i}.md`,
        )
        nodes[rootId] = leaf(rootId, childIds)
        for (const childId of childIds) {
            nodes[childId] = leaf(childId, [])
        }
    }
    return createGraph(nodes)
}

function bucketByComponent(nodeIds: readonly string[]): Map<number, string[]> {
    const buckets: Map<number, string[]> = new Map<number, string[]>()
    for (const id of nodeIds) {
        const m: RegExpMatchArray | null = id.match(/(?:root|c)(\d+)/)
        if (!m) continue
        const idx: number = Number(m[1])
        const existing: string[] | undefined = buckets.get(idx)
        if (existing) existing.push(id)
        else buckets.set(idx, [id])
    }
    return buckets
}

function projectedSubgraphs(projected: ProjectedGraph): readonly ComponentSubgraph[] {
    const fileNodes: readonly ProjectedNode[] = projected.nodes.filter(
        (n: ProjectedNode): boolean => n.kind === 'file' && n.position !== undefined,
    )
    const buckets: Map<number, string[]> = bucketByComponent(fileNodes.map((n: ProjectedNode): string => n.id))
    const result: ComponentSubgraph[] = []
    for (const ids of buckets.values()) {
        const positions: readonly Position[] = ids
            .map((id: string): Position | undefined => fileNodes.find((n: ProjectedNode): boolean => n.id === id)?.position)
            .filter((p): p is Position => p !== undefined)
        result.push({
            nodes: positions.map((p: Position) => ({ x: p.x, y: p.y, width: NODE_W, height: NODE_H })),
            edges: [],
        })
    }
    return result
}

function buildStateWithGraphAndPositions(graph: Graph): State {
    let state: State = { ...emptyState(), graph }
    const positions: Map<NodeIdAndFilePath, Position> = new Map<NodeIdAndFilePath, Position>()
    for (const node of Object.values(graph.nodes)) {
        const p: Position | undefined = O.toUndefined(node.nodeUIMetadata.position)
        if (p) positions.set(node.absoluteFilePathIsID, p)
    }
    state = applyCommand(state, { type: 'SetPositions', positions })
    return state
}

describe('Hot Zone C (d) — Disconnected components remain packed after re-projection', () => {
    it('two-component graph: applyPositions packs, project() preserves non-overlap', () => {
        const initialGraph: Graph = multiComponentGraph(2, 6)
        const positionedGraph: Graph = applyPositions(initialGraph)

        // Sanity: the source-of-truth (Graph layer) is non-overlapping.
        const sourceSubgraphs: readonly ComponentSubgraph[] = projectedSubgraphs(
            project(buildStateWithGraphAndPositions(positionedGraph)),
        )
        expect(sourceSubgraphs.length).toBe(2)
        expect(componentsOverlap(sourceSubgraphs)).toBe(false)
    })

    it('eight-component graph (real-folder shape): re-projecting after no-op mutations preserves non-overlap', () => {
        const positionedGraph: Graph = applyPositions(multiComponentGraph(8, 6))
        const state: State = buildStateWithGraphAndPositions(positionedGraph)

        // First projection — already packed by applyPositions.
        const first: ProjectedGraph = project(state)
        expect(componentsOverlap(projectedSubgraphs(first))).toBe(false)

        // Second projection (re-projection): same state, fresh call. Must
        // produce identical positions and remain non-overlapping.
        const second: ProjectedGraph = project(state)
        expect(componentsOverlap(projectedSubgraphs(second))).toBe(false)
        for (const node of first.nodes) {
            if (node.kind !== 'file') continue
            const match: ProjectedNode | undefined = second.nodes.find((n: ProjectedNode): boolean => n.id === node.id)
            expect(match?.position).toEqual(node.position)
        }
    })

    it('packed positions survive a SetPositions round-trip and remain non-overlapping under project()', () => {
        const positionedGraph: Graph = applyPositions(multiComponentGraph(4, 4))

        // Re-running applyPositions on already-positioned input must not
        // disturb the packing — the "anchored component" guard preserves
        // existing positions verbatim.
        const reapplied: Graph = applyPositions(positionedGraph)
        for (const id of Object.keys(positionedGraph.nodes)) {
            const a: Position | undefined = O.toUndefined(positionedGraph.nodes[id].nodeUIMetadata.position)
            const b: Position | undefined = O.toUndefined(reapplied.nodes[id].nodeUIMetadata.position)
            expect(b).toEqual(a)
        }

        const state: State = buildStateWithGraphAndPositions(reapplied)
        const projected: ProjectedGraph = project(state)
        expect(componentsOverlap(projectedSubgraphs(projected))).toBe(false)
    })

    it('empty graph projects without error and trivially non-overlapping', () => {
        const empty: Graph = createEmptyGraph()
        const state: State = buildStateWithGraphAndPositions(empty)
        const projected: ProjectedGraph = project(state)
        expect(projected.nodes.filter((n: ProjectedNode): boolean => n.kind === 'file').length).toBe(0)
        expect(componentsOverlap(projectedSubgraphs(projected))).toBe(false)
    })
})

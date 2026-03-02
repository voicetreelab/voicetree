import type { Node, Edge as RFEdge } from '@xyflow/react'
import * as O from 'fp-ts/lib/Option.js'
import type { GraphDelta, GraphNode, Position, UpsertNodeDelta } from '@/pure/graph'
import { getNodeTitle } from '@/pure/graph/markdown-parsing'

export interface ReactFlowGraphData {
    readonly nodes: Node[]
    readonly edges: RFEdge[]
}

export function graphDeltaToReactFlow(delta: GraphDelta): ReactFlowGraphData {
    const upserts: readonly UpsertNodeDelta[] = delta.filter((d): d is UpsertNodeDelta =>
        d.type === 'UpsertNode' && d.nodeToUpsert.nodeUIMetadata.isContextNode !== true
    )

    const positions: Position[] = upserts.map(d =>
        O.getOrElse(() => ({ x: 0, y: 0 }))(d.nodeToUpsert.nodeUIMetadata.position)
    )
    const minX: number = positions.length > 0 ? Math.min(...positions.map(p => p.x)) : 0
    const minY: number = positions.length > 0 ? Math.min(...positions.map(p => p.y)) : 0

    const nodes: Node[] = upserts.map((d, i) => {
        const node: GraphNode = d.nodeToUpsert
        const pos: Position = positions[i]
        return {
            id: node.absoluteFilePathIsID,
            type: 'markdown',
            position: { x: pos.x - minX, y: pos.y - minY },
            data: {
                label: getNodeTitle(node),
                content: node.contentWithoutYamlOrLinks,
                color: O.isSome(node.nodeUIMetadata.color) ? node.nodeUIMetadata.color.value : undefined
            }
        }
    })

    const nodeIds: Set<string> = new Set(nodes.map(n => n.id))
    const edges: RFEdge[] = upserts.flatMap(d => {
        const sourceId: string = d.nodeToUpsert.absoluteFilePathIsID
        return d.nodeToUpsert.outgoingEdges
            .filter(e => nodeIds.has(e.targetId))
            .map(e => ({
                id: `${sourceId}->${e.targetId}`,
                source: sourceId,
                target: e.targetId,
                label: e.label || undefined
            }))
    })

    return { nodes, edges }
}

/**
 * Compute a garden proposal preview for an over-full folder, from the in-memory
 * graph, at `create_graph` block time. Reuses the same structural planner as the
 * `vt graph garden` CLI ({@link buildGardenPlan}) so the suggestion the agent is
 * offered at the block matches exactly what `--apply` would do.
 *
 * Pure: no I/O. Returns '' when there is no multi-node community to suggest
 * (then the block guidance falls back to the manual / bypass options).
 */

import {basename} from 'node:path'
import type {Graph, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {getFolderChildNodeIds, getFolderIdentityNoteId} from '@vt/graph-model/graph'
import {getNodeTitle} from '@vt/graph-model/markdown'
import {buildGardenPlan, type GardenFolderNode} from '@vt/graph-tools/authoring/garden/plan'

function basenameNoMd(nodeId: string): string {
    return basename(nodeId).replace(/\.md$/i, '')
}

/** The folder's direct-child nodes as planner input (excludes the folder's own identity note). */
function folderNodesForPlanning(graph: Graph, folderPath: string): readonly GardenFolderNode[] {
    const identityNote: NodeIdAndFilePath = getFolderIdentityNoteId(folderPath)
    const childIds: readonly NodeIdAndFilePath[] = getFolderChildNodeIds(graph.nodes, folderPath)
    return childIds
        .filter((id) => id !== identityNote)
        .map((id) => {
            const node = graph.nodes[id]
            return {
                filename: basename(id),
                title: getNodeTitle(node),
                outgoingBasenames: node.outgoingEdges.map((edge) => basenameNoMd(edge.targetId)),
            }
        })
}

/**
 * Render the proposed sub-folder groupings as indented preview lines, e.g.
 * `      • agent-status-redesign ← nuke-list, add-status-plan`. Empty string when
 * the structural planner finds nothing to group.
 */
export function renderGardenProposal(graph: Graph, folderPath: string): string {
    const plan = buildGardenPlan(folderNodesForPlanning(graph, folderPath))
    return plan.clusters
        .map((cluster) => `      • ${cluster.folderName} ← ${cluster.members.map(basenameNoMd).join(', ')}`)
        .join('\n')
}

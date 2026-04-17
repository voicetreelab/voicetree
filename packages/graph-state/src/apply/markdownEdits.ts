import {
    parseMarkdownToGraphNode,
    type GraphDelta,
    type GraphNode,
    type NodeIdAndFilePath,
} from '@vt/graph-model'
import { fromNodeToContentWithWikilinks } from '@vt/graph-model/pure/graph/markdown-writing/node_to_markdown'

import type { State } from '../contract'
import type { EdgeChange, GraphDeltaSummary } from './folderTreeHelpers'

export function createEdgesRemovedGraphDelta(edgesRemoved: readonly EdgeChange[]): GraphDelta {
    const graphDelta = [] as unknown as GraphDeltaSummary
    Object.defineProperty(graphDelta, 'edgesRemoved', {
        value: edgesRemoved,
        enumerable: true,
    })
    return graphDelta
}

export function createEdgesAddedGraphDelta(edgesAdded: readonly EdgeChange[]): GraphDelta {
    const graphDelta = [] as unknown as GraphDeltaSummary
    Object.defineProperty(graphDelta, 'edgesAdded', {
        value: edgesAdded,
        enumerable: true,
    })
    return graphDelta
}

function normalizeMarkdownAfterLinkRemoval(markdown: string): string {
    return markdown
        .replace(/\s+(and|or)\s+([.,;:!?])/g, '$2')
        .replace(/\s+([.,;:!?])/g, '$1')
        .replace(/,\s*([.,;:!?])/g, '$1')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
}

function removeTargetLinksFromMarkdown(
    markdown: string,
    sourceNode: GraphNode,
    targetId: NodeIdAndFilePath,
): string {
    const matches: readonly RegExpMatchArray[] = [...markdown.matchAll(/\[\[[^\]]+\]\]/g)]

    if (matches.length === 0) {
        return markdown
    }

    let cursor = 0
    let nextMarkdown = ''

    matches.forEach((match: RegExpMatchArray, index: number) => {
        const start = match.index ?? cursor
        const edge = sourceNode.outgoingEdges[index]

        nextMarkdown += markdown.slice(cursor, start)
        if (edge?.targetId !== targetId) {
            nextMarkdown += match[0]
        }

        cursor = start + match[0].length
    })

    nextMarkdown += markdown.slice(cursor)
    return normalizeMarkdownAfterLinkRemoval(nextMarkdown)
}

export function rebuildSourceNodeForRemovedEdge(
    state: State,
    sourceNode: GraphNode,
    targetId: NodeIdAndFilePath,
): GraphNode {
    const markdownWithLinks = fromNodeToContentWithWikilinks(sourceNode)
    const cleanedMarkdown = removeTargetLinksFromMarkdown(
        markdownWithLinks,
        sourceNode,
        targetId,
    )
    const reparsedNode = parseMarkdownToGraphNode(
        cleanedMarkdown,
        sourceNode.absoluteFilePathIsID,
        state.graph,
    )

    return {
        ...sourceNode,
        contentWithoutYamlOrLinks: reparsedNode.contentWithoutYamlOrLinks,
        outgoingEdges: reparsedNode.outgoingEdges,
        nodeUIMetadata: sourceNode.nodeUIMetadata,
    }
}

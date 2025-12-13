import type {Graph, GraphDelta, NodeIdAndFilePath, GraphNode} from '@/pure/graph'
import {getUnionSubgraphByDistance, graphToAscii, getNodeIdsInTraversalOrder, CONTEXT_NODES_FOLDER} from '@/pure/graph'
import {getGraph} from '@/shell/edge/main/state/graph-store'
import {getWatchStatus} from '@/shell/edge/main/graph/watchFolder'
import {getCachedSettings} from '@/shell/edge/main/state/settings-cache'
import {DEFAULT_SETTINGS, type VTSettings} from '@/pure/settings/types'
import {parseMarkdownToGraphNode} from '@/pure/graph/markdown-parsing/parse-markdown-to-node'
import {fromCreateChildToUpsertNode} from '@/pure/graph/graphDelta/uiInteractionsToGraphDeltas'
import * as O from 'fp-ts/lib/Option.js'
import {
    applyGraphDeltaToDBThroughMemAndUIAndEditors
} from "@/shell/edge/main/graph/markdownHandleUpdateFromStateLayerPaths/onUIChangePath/onUIChange";

/** Truncate a title to at most 5 words */
function truncateToFiveWords(text: string): string {
    const words: string[] = text.split(/\s+/)
    return words.length <= 5 ? text : words.slice(0, 5).join(' ') + '...'
}

/**
 * Creates a context node for Ask Mode from multiple relevant nodes.
 *
 * @param relevantNodeIds - Node IDs from hybrid search results
 * @param question - The user's original question
 * @returns The NodeId of the created context node
 */
export async function createContextNodeFromQuestion(
    relevantNodeIds: readonly NodeIdAndFilePath[],
    question: string
): Promise<NodeIdAndFilePath> {
    const currentGraph: Graph = getGraph()
    const settings: VTSettings = getCachedSettings() ?? DEFAULT_SETTINGS
    const maxDistance: number = settings.askModeContextDistance

    const validNodeIds: readonly NodeIdAndFilePath[] = relevantNodeIds
        .filter(id => currentGraph.nodes[id])

    if (validNodeIds.length === 0) {
        throw new Error('No valid nodes found from search results')
    }

    const subgraph: Graph = getUnionSubgraphByDistance(
        currentGraph,
        validNodeIds,
        maxDistance
    )

    const timestamp: number = Date.now()
    const vaultSuffix: string = getWatchStatus().vaultSuffix

    // 1. Create standalone question node (no parent)
    const questionNodeId: string = vaultSuffix
        ? `${vaultSuffix}/ask_${timestamp}.md`
        : `ask_${timestamp}.md`

    const questionContent: string = `# Question: "${truncateToFiveWords(question)}"

The user has asked a question, your task is to answer it by reading all the relevant context provided.
`
    const parsedQuestionNode: GraphNode = parseMarkdownToGraphNode(questionContent, questionNodeId, currentGraph)
    const questionNode: GraphNode = {
        relativeFilePathIsID: questionNodeId,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: parsedQuestionNode.contentWithoutYamlOrLinks,
        nodeUIMetadata: {
            ...parsedQuestionNode.nodeUIMetadata,
            position: O.none,
        },
    }

    // Apply question node first so it exists in graph for context node creation
    const questionDelta: GraphDelta = [{
        type: 'UpsertNode',
        nodeToUpsert: questionNode,
        previousNode: O.none
    }]
    await applyGraphDeltaToDBThroughMemAndUIAndEditors(questionDelta)

    // 2. Create context node as child of question node
    const contextNodeId: string = vaultSuffix
        ? `${vaultSuffix}/${CONTEXT_NODES_FOLDER}/ask_${timestamp}.md`
        : `${CONTEXT_NODES_FOLDER}/ask_${timestamp}.md`

    const asciiTree: string = graphToAscii(subgraph)
    const contextContent: string = buildAskModeContent(
        question,
        validNodeIds,
        asciiTree,
        subgraph
    )

    // Get fresh graph with question node included
    const updatedGraph: Graph = getGraph()
    const questionNodeFromGraph: GraphNode = updatedGraph.nodes[questionNodeId]

    const contextDelta: GraphDelta = fromCreateChildToUpsertNode(
        updatedGraph,
        questionNodeFromGraph,
        contextContent,
        contextNodeId
    )

    await applyGraphDeltaToDBThroughMemAndUIAndEditors(contextDelta)

    return contextNodeId
}

function buildAskModeContent(
    question: string,
    relevantNodeIds: readonly NodeIdAndFilePath[],
    asciiTree: string,
    subgraph: Graph
): string {
    const nodeDetailsList: string = generateNodeDetailsList(subgraph, relevantNodeIds, question)

    const containedNodeIds: readonly string[] = Object.keys(subgraph.nodes)
        .filter(nodeId => !subgraph.nodes[nodeId].nodeUIMetadata.isContextNode)

    const containedNodeIdsYaml: string = containedNodeIds.length > 0
        ? `containedNodeIds:\n${containedNodeIds.map(id => `  - ${id}`).join('\n')}\n`
        : ''

    return `---
title: "ASK: '${truncateToFiveWords(question)}'"
isContextNode: true
${containedNodeIdsYaml}---

## ASK: '${question}'
\`\`\`
${asciiTree}
\`\`\`

## Node Details
${nodeDetailsList}
`
}

function generateNodeDetailsList(
    subgraph: Graph,
    relevantNodeIds: readonly NodeIdAndFilePath[],
    question: string
): string {
    const lines: string[] = []
    const orderedNodeIds: readonly string[] = getNodeIdsInTraversalOrder(subgraph)

    for (const nodeId of orderedNodeIds) {
        const node: GraphNode = subgraph.nodes[nodeId]
        if (node.nodeUIMetadata.isContextNode) continue

        const isRelevant: boolean = relevantNodeIds.includes(nodeId)
        const marker: string = isRelevant ? ' [RELEVANT]' : ''
        const contentClean: string = node.contentWithoutYamlOrLinks.replace(/\[([^\]]+)\]\*/g, '[$1]')

        lines.push(`<${node.relativeFilePathIsID}>${marker}\n ${contentClean} \n </${node.relativeFilePathIsID}>`)
    }

    lines.push(`<TASK> Answer this question: ${question} </TASK>`)

    return lines.join('\n')
}

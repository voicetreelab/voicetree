import path from 'path'
import * as O from 'fp-ts/lib/Option.js'
import normalizePath from 'normalize-path'
import {applyGraphDeltaToGraph, ensureUniqueNodeId} from '@vt/graph-model/graph'
import type {Graph, GraphNode, NodeDelta, NodeIdAndFilePath, Position} from '@vt/graph-model/graph'
import {parseMarkdownToGraphNode} from '@vt/graph-model/markdown'
import {buildMarkdownBody} from '@vt/graph-tools/node'
import {buildSpatialIndexFromGraph, calculateNodePosition} from '@vt/graph-model/spatial'
import type {SpatialIndex} from '@vt/graph-model/spatial'
import {
    extractMermaidBlocks,
    parseDiagramParam,
    slugify,
    type MermaidBlock,
    validateMermaidBlocks,
} from '../tools/graph/addProgressNodeTool'
import {
    parentRefEdgeLabel,
    parentRefFilename,
} from './createGraphTopology'
import type {
    BatchBuildResult,
    CreatedNodeInfo,
    CreateGraphNodeInput,
    GraphParentContext,
    NodeDeltaDraft,
    NodeDraft,
    NodeParentContext,
    ParentCandidate,
    ParentLink,
    ParentRef,
    Result,
} from './createGraphTypes'

function parentCandidateFor(
    parentRef: ParentRef,
    createdNodes: ReadonlyMap<string, CreatedNodeInfo>,
    createdPositions: ReadonlyMap<string, Position>,
    graphParentPosition: Position
): ParentCandidate | null {
    const parentFilename: string = parentRefFilename(parentRef)
    const parentInfo: CreatedNodeInfo | undefined = createdNodes.get(parentFilename)
    if (!parentInfo) return null

    return {
        link: {
            baseName: parentInfo.baseName,
            edgeLabel: parentRefEdgeLabel(parentRef),
        },
        position: createdPositions.get(parentFilename) ?? graphParentPosition,
        nodeId: parentInfo.nodeId,
    }
}

function selectRightmostParent(current: ParentCandidate, candidate: ParentCandidate): ParentCandidate {
    return candidate.position.x > current.position.x ? candidate : current
}

function resolveNodeParents(
    node: CreateGraphNodeInput,
    createdNodes: ReadonlyMap<string, CreatedNodeInfo>,
    createdPositions: ReadonlyMap<string, Position>,
    graphParent: GraphParentContext
): NodeParentContext {
    const candidates: readonly ParentCandidate[] = (node.parents ?? [])
        .map(parentRef => parentCandidateFor(parentRef, createdNodes, createdPositions, graphParent.graphParentPosition))
        .filter((candidate): candidate is ParentCandidate => candidate !== null)

    if (candidates.length === 0) {
        return {
            parentLinks: [{baseName: graphParent.graphParentBaseName, edgeLabel: undefined}],
            deepestParentPosition: graphParent.graphParentPosition,
            deepestParentNodeId: graphParent.resolvedGraphParentId,
        }
    }

    const deepestParent: ParentCandidate = candidates.reduce(selectRightmostParent)
    return {
        parentLinks: candidates.map(candidate => candidate.link),
        deepestParentPosition: deepestParent.position,
        deepestParentNodeId: deepestParent.nodeId,
    }
}

function calculateProgressNodePosition(localGraph: Graph, parentContext: NodeParentContext): Position {
    const spatialIndex: SpatialIndex = buildSpatialIndexFromGraph(localGraph)
    return O.getOrElse(() => parentContext.deepestParentPosition)(
        calculateNodePosition(localGraph, spatialIndex, parentContext.deepestParentNodeId)
    )
}

function buildNodeMarkdown(
    node: CreateGraphNodeInput,
    parentLinks: readonly ParentLink[],
    agentName: string,
    defaultColor: string
): string {
    return buildMarkdownBody({
        title: node.title,
        summary: node.summary,
        content: node.content,
        codeDiffs: node.codeDiffs,
        filesChanged: node.filesChanged,
        diagram: node.diagram,
        notes: node.notes,
        linkedArtifacts: node.linkedArtifacts,
        complexityScore: node.complexityScore,
        complexityExplanation: node.complexityExplanation,
        color: node.color ?? defaultColor,
        agentName,
        parentLinks,
    })
}

function mermaidBlocksForNode(node: CreateGraphNodeInput): MermaidBlock[] {
    const contentBlocks: MermaidBlock[] = node.content ? [...extractMermaidBlocks(node.content)] : []
    if (!node.diagram) return contentBlocks

    const diagramBlock: MermaidBlock = parseDiagramParam(node.diagram)
    return [...contentBlocks, {...diagramBlock, index: contentBlocks.length}]
}

async function mermaidWarningForNode(node: CreateGraphNodeInput): Promise<string | undefined> {
    const allMermaidBlocks: MermaidBlock[] = mermaidBlocksForNode(node)
    if (allMermaidBlocks.length === 0) return undefined

    return await validateMermaidBlocks(allMermaidBlocks) ?? undefined
}

function reserveNodeId(
    filename: string,
    outputDirectory: string,
    existingIds: Set<string>
): CreatedNodeInfo {
    const rawFilename: string = filename.replace(/\.md$/, '')
    const nodeSlug: string = slugify(rawFilename)
    const candidateId: string = normalizePath(path.join(outputDirectory, `${nodeSlug || 'graph-node'}.md`))
    const nodeId: NodeIdAndFilePath = ensureUniqueNodeId(candidateId, existingIds)
    existingIds.add(nodeId)

    return {
        nodeId,
        baseName: nodeId.split('/').pop()?.replace(/\.md$/, '') ?? nodeSlug,
    }
}

function draftNodeDelta(draft: NodeDraft, localGraph: Graph): Result<NodeDeltaDraft> {
    try {
        const parsedNode: GraphNode = parseMarkdownToGraphNode(draft.markdownContent, draft.nodeId, localGraph)
        const progressNode: GraphNode = {
            ...parsedNode,
            absoluteFilePathIsID: draft.nodeId,
            nodeUIMetadata: {
                ...parsedNode.nodeUIMetadata,
                position: O.some(draft.nodePosition),
            }
        }

        return {
            ok: true,
            value: {
                delta: [{
                    type: 'UpsertNode',
                    nodeToUpsert: progressNode,
                    previousNode: O.none,
                }],
            },
        }
    } catch (error: unknown) {
        const errorMessage: string = error instanceof Error ? error.message : String(error)
        return {ok: false, error: `Creation failed: ${errorMessage}`}
    }
}

async function buildNodeDraft(
    node: CreateGraphNodeInput,
    localGraph: Graph,
    outputDirectory: string,
    existingIds: Set<string>,
    createdNodes: ReadonlyMap<string, CreatedNodeInfo>,
    createdPositions: ReadonlyMap<string, Position>,
    graphParent: GraphParentContext,
    agentName: string,
    defaultColor: string
): Promise<NodeDraft> {
    const parentContext: NodeParentContext = resolveNodeParents(node, createdNodes, createdPositions, graphParent)
    const nodePosition: Position = calculateProgressNodePosition(localGraph, parentContext)
    const createdInfo: CreatedNodeInfo = reserveNodeId(node.filename, outputDirectory, existingIds)

    return {
        node,
        nodeId: createdInfo.nodeId,
        baseName: createdInfo.baseName,
        nodePosition,
        markdownContent: buildNodeMarkdown(node, parentContext.parentLinks, agentName, defaultColor),
        warning: await mermaidWarningForNode(node),
    }
}

function nodeSuccessResult(draft: NodeDraft) {
    return {
        id: draft.nodeId,
        path: draft.nodeId,
        status: draft.warning ? 'warning' as const : 'ok' as const,
        ...(draft.warning ? {warning: `${draft.warning} — fix at ${draft.nodeId}`} : {}),
    }
}

function nodeFailureResult(draft: NodeDraft, warning: string) {
    return {
        id: draft.nodeId,
        path: draft.nodeId,
        status: 'warning' as const,
        warning,
    }
}

export async function buildNodeBatch(
    sortedNodes: readonly CreateGraphNodeInput[],
    graph: Graph,
    outputDirectory: string,
    graphParent: GraphParentContext,
    agentName: string,
    defaultColor: string
): Promise<BatchBuildResult> {
    let localGraph: Graph = graph
    const batchDelta: NodeDelta[] = []
    const existingIds: Set<string> = new Set(Object.keys(graph.nodes))
    const allNewNodeIds: NodeIdAndFilePath[] = []
    const createdNodes: Map<string, CreatedNodeInfo> = new Map()
    const createdPositions: Map<string, Position> = new Map()
    const results = []

    for (const node of sortedNodes) {
        const draft: NodeDraft = await buildNodeDraft(
            node, localGraph, outputDirectory, existingIds, createdNodes, createdPositions, graphParent, agentName, defaultColor
        )
        const deltaDraft: Result<NodeDeltaDraft> = draftNodeDelta(draft, localGraph)
        if (!deltaDraft.ok) {
            results.push(nodeFailureResult(draft, deltaDraft.error))
            continue
        }

        batchDelta.push(...deltaDraft.value.delta)
        localGraph = applyGraphDeltaToGraph(localGraph, deltaDraft.value.delta)
        allNewNodeIds.push(draft.nodeId)
        createdNodes.set(node.filename, {nodeId: draft.nodeId, baseName: draft.baseName})
        createdPositions.set(node.filename, draft.nodePosition)
        results.push(nodeSuccessResult(draft))
    }

    return {batchDelta, allNewNodeIds, createdNodes, results}
}

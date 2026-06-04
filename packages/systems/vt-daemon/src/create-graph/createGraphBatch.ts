import path from 'path'
import * as O from 'fp-ts/lib/Option.js'
import normalizePath from 'normalize-path'
import {applyGraphDeltaToGraph, ensureUniqueNodeId} from '@vt/graph-model/graph'
import type {Graph, GraphNode, NodeDelta, NodeIdAndFilePath} from '@vt/graph-model/graph'
import {
    extractParentRefs,
    normalizeBatchFilenameKey,
    parseMarkdownToGraphNode,
    type ParentLineRef,
} from '@vt/graph-model/markdown'
import {buildMarkdownBody} from '@vt/graph-tools/node-runtime'
import {
    extractMermaidBlocks,
    parseDiagramParam,
    type MermaidBlock,
    validateMermaidBlocks,
} from '../tools/graph/addProgressNodeTool'
import {slugify} from '../_shared/slugify.ts'
import type {
    BatchBuildResult,
    CreatedNodeInfo,
    CreateGraphNodeInput,
    GraphParentContext,
    NodeDeltaDraft,
    NodeDraft,
    ParentLink,
    Result,
} from './createGraphTypes'

const PARENT_LINE_PATTERN: RegExp = /^[ \t]*(?:[-*+][ \t]+)?parent[ \t]+\[\[[^[\]\n\r]+\]\][ \t]*$/
const FENCE_OPEN: RegExp = /^[ \t]*(```|~~~)/

/**
 * Strip parent-declaration lines from a markdown body, leaving fenced code
 * blocks untouched. Grammar matches `extractParentRefs` in graph-model so the
 * strip + re-emit round trip cannot desync (an indented `- parent [[X]]` that
 * the parser caught but the strip missed would yield a duplicate parent edge
 * on the next read). Collapses runs of ≥3 newlines back down to a single
 * blank line so removed lines don't leave gaps.
 */
export function stripParentLines(content: string | undefined): string | undefined {
    if (!content) return content
    const lines: readonly string[] = content.split(/\r?\n/)
    const kept: string[] = []
    let inFence: boolean = false
    let fenceMarker: string | undefined
    for (const line of lines) {
        const openMatch: RegExpExecArray | null = FENCE_OPEN.exec(line)
        if (openMatch) {
            if (!inFence) {
                inFence = true
                fenceMarker = openMatch[1]
            } else if (fenceMarker && line.trim().startsWith(fenceMarker)) {
                inFence = false
                fenceMarker = undefined
            }
            kept.push(line)
            continue
        }
        if (inFence) {
            kept.push(line)
            continue
        }
        if (PARENT_LINE_PATTERN.test(line)) continue
        kept.push(line)
    }
    return kept.join('\n').replace(/\n{3,}/g, '\n\n')
}

/**
 * Parent edges live in the node's content body as `- parent [[name|label]]`
 * lines. We extract them, resolve in-batch filenames to their post-slug
 * baseNames, and re-emit them at the canonical end-of-body position via
 * `buildMarkdownBody`; the original lines are stripped from `content` so the
 * final markdown has exactly one source of truth. Refs that don't match an
 * in-batch `createdNodes` entry are re-emitted unchanged — the wikilink
 * parser resolves them against the live graph at apply time. The graphParent
 * fallback fires only when no parent lines were authored at all.
 */
function resolveParentLinks(
    node: CreateGraphNodeInput,
    createdNodes: ReadonlyMap<string, CreatedNodeInfo>,
    graphParent: GraphParentContext
): readonly ParentLink[] {
    const refs: readonly ParentLineRef[] = extractParentRefs(node.content ?? '')
    if (refs.length === 0) {
        return [{baseName: graphParent.graphParentBaseName, edgeLabel: undefined}]
    }
    return refs.map((ref: ParentLineRef): ParentLink => {
        const inBatch: CreatedNodeInfo | undefined = createdNodes.get(ref.filename)
        return {baseName: inBatch?.baseName ?? ref.filename, edgeLabel: ref.edgeLabel}
    })
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
        content: stripParentLines(node.content),
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
        // Position is deliberately not set here. The daemon's
        // resolveInitialPositionsForDelta fills it in from the parent edge at
        // apply-time; authoring stays pure per CLAUDE.md.
        const parsedNode: GraphNode = parseMarkdownToGraphNode(draft.markdownContent, draft.nodeId, localGraph)
        const progressNode: GraphNode = {
            ...parsedNode,
            absoluteFilePathIsID: draft.nodeId,
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
    outputDirectory: string,
    existingIds: Set<string>,
    createdNodes: ReadonlyMap<string, CreatedNodeInfo>,
    graphParent: GraphParentContext,
    agentName: string,
    defaultColor: string
): Promise<NodeDraft> {
    const parentLinks: readonly ParentLink[] = resolveParentLinks(node, createdNodes, graphParent)
    const createdInfo: CreatedNodeInfo = reserveNodeId(node.filename, outputDirectory, existingIds)

    return {
        node,
        nodeId: createdInfo.nodeId,
        baseName: createdInfo.baseName,
        markdownContent: buildNodeMarkdown(node, parentLinks, agentName, defaultColor),
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
    const results = []

    for (const node of sortedNodes) {
        const draft: NodeDraft = await buildNodeDraft(
            node, outputDirectory, existingIds, createdNodes, graphParent, agentName, defaultColor
        )
        const deltaDraft: Result<NodeDeltaDraft> = draftNodeDelta(draft, localGraph)
        if (!deltaDraft.ok) {
            results.push(nodeFailureResult(draft, deltaDraft.error))
            continue
        }

        batchDelta.push(...deltaDraft.value.delta)
        localGraph = applyGraphDeltaToGraph(localGraph, deltaDraft.value.delta)
        allNewNodeIds.push(draft.nodeId)
        // Key by the normalized form so a child's `- parent [[parent.md]]` and
        // an input filename of `parent` (or vice versa) compare equal — matches
        // the normalization extractParentRefs applies to wikilink targets.
        createdNodes.set(normalizeBatchFilenameKey(node.filename), {nodeId: draft.nodeId, baseName: draft.baseName})
        results.push(nodeSuccessResult(draft))
    }

    return {batchDelta, allNewNodeIds, createdNodes, results}
}

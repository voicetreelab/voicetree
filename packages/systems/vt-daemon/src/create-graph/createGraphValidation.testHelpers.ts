/**
 * Shared test helpers for createGraphValidation tests.
 * Pure factory functions for building mock objects — no side effects.
 */

import type {Graph, GraphNode, NodeIdAndFilePath, Position} from '@vt/graph-model/graph'
import {
    DEFAULT_SUBGRAPH_WARN_THRESHOLD,
    DEFAULT_SUBGRAPH_ERROR_THRESHOLD,
    DEFAULT_MAX_CHILDREN_PER_NODE,
    DEFAULT_COMPLEXITY_WARN_SCORE,
    DEFAULT_COMPLEXITY_BLOCK_SCORE,
} from '@vt/graph-model/settings'
import type {CreateGraphNodeInput} from './createGraphTypes'
import type {ValidationContext} from './createGraphValidation'

/** Build a minimal mock graph with given nodes and edge index. */
export function mockGraph(
    nodeIds: readonly string[],
    incomingEdges: ReadonlyMap<NodeIdAndFilePath, readonly NodeIdAndFilePath[]> = new Map(),
): Graph {
    const nodes: Record<NodeIdAndFilePath, GraphNode> = {}
    for (const id of nodeIds) {
        nodes[id] = {
            kind: 'leaf',
            absoluteFilePathIsID: id,
            outgoingEdges: [],
            contentWithoutYamlOrLinks: '',
            nodeUIMetadata: {
                color: {_tag: 'None'} as import('fp-ts/lib/Option.js').Option<string>,
                position: {_tag: 'None'} as import('fp-ts/lib/Option.js').Option<Position>,
                additionalYAMLProps: {},
            },
        }
    }
    return {
        nodes,
        incomingEdgesIndex: incomingEdges,
        nodeByBaseName: new Map(),
        unresolvedLinksIndex: new Map(),
    }
}

/** Build a simple CreateGraphNodeInput for testing. */
export function mockNode(
    overrides: Partial<CreateGraphNodeInput> & {filename: string; title: string; summary: string},
): CreateGraphNodeInput {
    return overrides
}

/** Generate a string with the specified number of lines. */
export function linesOfText(count: number): string {
    return Array.from({length: count}, (_: unknown, i: number) => `Line ${i + 1}`).join('\n')
}

/** Build a ValidationContext for testing. */
export function buildCtx(
    overrides: Partial<ValidationContext> & {resolvedParentNodeId: NodeIdAndFilePath; graph: Graph},
): ValidationContext {
    return {
        nodes: overrides.nodes ?? [],
        resolvedParentNodeId: overrides.resolvedParentNodeId,
        callerTaskNodeId: overrides.callerTaskNodeId ?? null,
        graph: overrides.graph,
        lineLimit: overrides.lineLimit ?? 70,
        subgraphWarnThreshold: overrides.subgraphWarnThreshold ?? DEFAULT_SUBGRAPH_WARN_THRESHOLD,
        subgraphErrorThreshold: overrides.subgraphErrorThreshold ?? DEFAULT_SUBGRAPH_ERROR_THRESHOLD,
        maxChildrenPerNode: overrides.maxChildrenPerNode ?? DEFAULT_MAX_CHILDREN_PER_NODE,
        complexityWarnScore: overrides.complexityWarnScore ?? DEFAULT_COMPLEXITY_WARN_SCORE,
        complexityBlockScore: overrides.complexityBlockScore ?? DEFAULT_COMPLEXITY_BLOCK_SCORE,
        destinationFolderPath: overrides.destinationFolderPath ?? '',
    }
}

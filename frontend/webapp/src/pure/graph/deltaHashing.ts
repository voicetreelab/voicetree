import * as O from 'fp-ts/lib/Option.js'
import { pipe } from 'fp-ts/lib/function.js'
import type { GraphDelta, GraphNode, NodeDelta, UpsertNodeDelta, DeleteNode, NodeUIMetadata } from './index'
import { stripBracketedContent } from './contentChangeDetection'

/**
 * Strip whitespace (spaces, newlines, tabs) from a string for normalization.
 */
const stripWhitespace: (str: string) => string = (str) => str.replace(/\s+/g, '')

/**
 * Normalize a GraphNode for hashing by:
 * - Stripping bracket content from contentWithoutYamlOrLinks
 * - Stripping whitespace (spaces, newlines) to avoid spurious diffs
 * - Removing position from nodeUIMetadata
 */
const normalizeNodeForHashing: (node: GraphNode) => GraphNode = (node) => ({
    ...node,
    contentWithoutYamlOrLinks: stripWhitespace(stripBracketedContent(node.contentWithoutYamlOrLinks)),
    nodeUIMetadata: {
        ...node.nodeUIMetadata,
        position: O.none
    }
})

/**
 * Normalize a single NodeDelta for hashing.
 * Note: previousNode is not normalized as it's excluded from serialization anyway.
 */
const normalizeNodeDeltaForHashing: (delta: NodeDelta) => NodeDelta = (delta) => {
    if (delta.type === 'DeleteNode') {
        const deleteDelta: DeleteNode = delta
        return {
            ...deleteDelta,
            deletedNode: pipe(
                deleteDelta.deletedNode,
                O.map(normalizeNodeForHashing)
            )
        }
    }

    const upsertDelta: UpsertNodeDelta = delta
    return {
        ...upsertDelta,
        nodeToUpsert: normalizeNodeForHashing(upsertDelta.nodeToUpsert),
        previousNode: upsertDelta.previousNode // Not normalized - excluded from serialization
    }
}

/**
 * Normalize a GraphDelta for hashing by stripping bracket content, whitespace, and position.
 * Pure function - returns a new delta without mutating the original.
 */
export const normalizeDeltaForHashing: (delta: GraphDelta) => GraphDelta = (delta) =>
    delta.map(normalizeNodeDeltaForHashing)

/**
 * Simple string hash function (djb2 algorithm).
 * Chosen for speed and simplicity - suitable for non-cryptographic hashing.
 */
const djb2Hash: (str: string) => string = (str) => {
    const hash: number = [...str].reduce(
        (acc: number, char: string) => ((acc << 5) + acc) + char.charCodeAt(0) & 0xFFFFFFFF,
        5381
    )
    return (hash >>> 0).toString(16)
}

type SerializedMetadata = {
    readonly color: string | null
    readonly position: null
    readonly additionalYAMLProps: Record<string, unknown>
    readonly isContextNode?: boolean
    readonly containedNodeIds?: readonly string[]
}

type SerializedNode = {
    readonly relativeFilePathIsID: string
    readonly contentWithoutYamlOrLinks: string
    readonly outgoingEdges: readonly unknown[]
    readonly nodeUIMetadata: SerializedMetadata
}

type SerializedNodeDelta = {
    readonly type: string
    readonly nodeId?: string
    readonly deletedNode?: SerializedNode | null
    readonly nodeToUpsert?: SerializedNode
}

const serializeMetadata: (metadata: NodeUIMetadata) => SerializedMetadata = (metadata) => ({
    color: O.toNullable(metadata.color),
    position: null, // Always null after normalization
    additionalYAMLProps: Object.fromEntries(metadata.additionalYAMLProps),
    isContextNode: metadata.isContextNode,
    containedNodeIds: metadata.containedNodeIds
})

const serializeNode: (node: GraphNode) => SerializedNode = (node) => ({
    relativeFilePathIsID: node.relativeFilePathIsID,
    contentWithoutYamlOrLinks: node.contentWithoutYamlOrLinks,
    outgoingEdges: node.outgoingEdges,
    nodeUIMetadata: serializeMetadata(node.nodeUIMetadata)
})

// Note: previousNode is intentionally excluded from hash/comparison.
// It varies based on when delta is computed relative to graph state,
// but doesn't affect delta identity (same logical change).
const serializeNodeDelta: (nodeDelta: NodeDelta) => SerializedNodeDelta = (nodeDelta) => {
    if (nodeDelta.type === 'DeleteNode') {
        return {
            type: nodeDelta.type,
            nodeId: nodeDelta.nodeId,
            deletedNode: pipe(nodeDelta.deletedNode, O.map(serializeNode), O.toNullable)
        }
    }
    return {
        type: nodeDelta.type,
        nodeToUpsert: serializeNode(nodeDelta.nodeToUpsert)
    }
}

/**
 * Serialize a delta to a stable object for hashing/comparison.
 * Handles Map serialization and Option normalization.
 * Excludes previousNode as it doesn't affect delta identity.
 */
const serializeDeltaForComparison: (delta: GraphDelta) => readonly SerializedNodeDelta[] = (delta) =>
    delta.map(serializeNodeDelta)

/**
 * Serialize a delta to a stable JSON string for hashing.
 */
const serializeDeltaForHashing: (delta: GraphDelta) => string = (delta) =>
    JSON.stringify(serializeDeltaForComparison(delta))

/**
 * Hash a GraphDelta for equality comparison.
 * Ignores position, whitespace, and bracket content.
 * Pure function.
 */
export const hashGraphDelta: (delta: GraphDelta) => string = (delta) => {
    const normalized: GraphDelta = normalizeDeltaForHashing(delta)
    const serialized: string = serializeDeltaForHashing(normalized)
    return djb2Hash(serialized)
}

export type PropertyDifference = {
    readonly path: string
    readonly value1: unknown
    readonly value2: unknown
}

export type DeltaComparisonResult =
    | { readonly matching: true }
    | { readonly matching: false; readonly differences: readonly PropertyDifference[] }

/**
 * Compare two deltas and report which properties differ.
 * Dynamically loops through object keys rather than assuming structure.
 * Uses same serialization as hash (excludes previousNode, position, bracket content).
 * Useful for debugging why two deltas don't match.
 */
export const compareDeltasForDebugging: (
    delta1: GraphDelta,
    delta2: GraphDelta
) => DeltaComparisonResult = (delta1, delta2) => {
    const collectDifferences: (
        obj1: unknown,
        obj2: unknown,
        path: string,
        acc: readonly PropertyDifference[]
    ) => readonly PropertyDifference[] = (obj1, obj2, path, acc) => {
        // Handle null/undefined
        if (obj1 === null || obj1 === undefined || obj2 === null || obj2 === undefined) {
            return obj1 !== obj2 ? [...acc, { path, value1: obj1, value2: obj2 }] : acc
        }

        // Handle arrays
        if (Array.isArray(obj1) && Array.isArray(obj2)) {
            const maxLen: number = Math.max(obj1.length, obj2.length)
            return Array.from({ length: maxLen }).reduce<readonly PropertyDifference[]>(
                (innerAcc: readonly PropertyDifference[], _: unknown, i: number) =>
                    collectDifferences(obj1[i], obj2[i], `${path}[${i}]`, innerAcc),
                acc
            )
        }

        // Handle objects
        if (typeof obj1 === 'object' && typeof obj2 === 'object') {
            const keys1: readonly string[] = Object.keys(obj1 as object)
            const keys2: readonly string[] = Object.keys(obj2 as object)
            const allKeys: readonly string[] = [...new Set([...keys1, ...keys2])]

            return allKeys.reduce<readonly PropertyDifference[]>(
                (innerAcc: readonly PropertyDifference[], key: string) => {
                    const val1: unknown = (obj1 as Record<string, unknown>)[key]
                    const val2: unknown = (obj2 as Record<string, unknown>)[key]
                    return collectDifferences(val1, val2, path ? `${path}.${key}` : key, innerAcc)
                },
                acc
            )
        }

        // Primitives - compare values directly
        return obj1 !== obj2 ? [...acc, { path, value1: obj1, value2: obj2 }] : acc
    }

    // Normalize and serialize both deltas (same as hash - excludes previousNode)
    const serialized1: readonly SerializedNodeDelta[] = serializeDeltaForComparison(normalizeDeltaForHashing(delta1))
    const serialized2: readonly SerializedNodeDelta[] = serializeDeltaForComparison(normalizeDeltaForHashing(delta2))

    const differences: readonly PropertyDifference[] = collectDifferences(serialized1, serialized2, '', [])

    if (differences.length === 0) {
        return { matching: true }
    }

    return { matching: false, differences }
}

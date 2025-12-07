import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { hashGraphDelta, normalizeDeltaForHashing, compareDeltasForDebugging } from './deltaHashing'
import type { GraphDelta, GraphNode, UpsertNodeDelta } from './index'

const makeNode: (overrides?: Partial<GraphNode>) => GraphNode = (overrides = {}) => ({
    relativeFilePathIsID: 'test.md',
    contentWithoutYamlOrLinks: 'Some content',
    outgoingEdges: [],
    nodeUIMetadata: {
        color: O.none,
        position: O.none,
        additionalYAMLProps: new Map()
    },
    ...overrides
})

const makeUpsertDelta: (node: GraphNode, previousNode?: O.Option<GraphNode>) => UpsertNodeDelta = (node, previousNode = O.none) => ({
    type: 'UpsertNode',
    nodeToUpsert: node,
    previousNode
})

describe('normalizeDeltaForHashing', () => {
    it('should strip bracket content and whitespace from node content', () => {
        const node: GraphNode = makeNode({ contentWithoutYamlOrLinks: 'Text with [link]* and [another]* here' })
        const delta: GraphDelta = [makeUpsertDelta(node)]

        const normalized: GraphDelta = normalizeDeltaForHashing(delta)

        const normalizedNode: GraphNode = (normalized[0] as UpsertNodeDelta).nodeToUpsert
        // Whitespace is stripped along with bracket content
        expect(normalizedNode.contentWithoutYamlOrLinks).toBe('Textwith*and*here')
    })

    it('should remove position from nodeUIMetadata', () => {
        const node: GraphNode = makeNode({
            nodeUIMetadata: {
                color: O.some('red'),
                position: O.some({ x: 100, y: 200 }),
                additionalYAMLProps: new Map()
            }
        })
        const delta: GraphDelta = [makeUpsertDelta(node)]

        const normalized: GraphDelta = normalizeDeltaForHashing(delta)

        const normalizedNode: GraphNode = (normalized[0] as UpsertNodeDelta).nodeToUpsert
        expect(O.isNone(normalizedNode.nodeUIMetadata.position)).toBe(true)
        expect(normalizedNode.nodeUIMetadata.color).toEqual(O.some('red'))
    })

    it('should normalize nodeToUpsert but not previousNode (excluded from serialization)', () => {
        const currentNode: GraphNode = makeNode({ contentWithoutYamlOrLinks: 'Current [link]*' })
        const previousNode: GraphNode = makeNode({
            contentWithoutYamlOrLinks: 'Previous [old]*',
            nodeUIMetadata: {
                color: O.none,
                position: O.some({ x: 50, y: 50 }),
                additionalYAMLProps: new Map()
            }
        })
        const delta: GraphDelta = [makeUpsertDelta(currentNode, O.some(previousNode))]

        const normalized: GraphDelta = normalizeDeltaForHashing(delta)

        const normalizedDelta: UpsertNodeDelta = normalized[0] as UpsertNodeDelta
        // nodeToUpsert is normalized (whitespace stripped)
        expect(normalizedDelta.nodeToUpsert.contentWithoutYamlOrLinks).toBe('Current*')

        // previousNode is passed through unchanged (it's excluded from serialization anyway)
        const normalizedPrev: GraphNode | null = O.getOrElseW(() => null)(normalizedDelta.previousNode)
        expect(normalizedPrev?.contentWithoutYamlOrLinks).toBe('Previous [old]*')
    })
})

describe('hashGraphDelta', () => {
    it('should produce same hash for deltas differing only in position', () => {
        const node1: GraphNode = makeNode({
            nodeUIMetadata: {
                color: O.none,
                position: O.some({ x: 100, y: 200 }),
                additionalYAMLProps: new Map()
            }
        })
        const node2: GraphNode = makeNode({
            nodeUIMetadata: {
                color: O.none,
                position: O.some({ x: 999, y: 888 }),
                additionalYAMLProps: new Map()
            }
        })

        const hash1: string = hashGraphDelta([makeUpsertDelta(node1)])
        const hash2: string = hashGraphDelta([makeUpsertDelta(node2)])

        expect(hash1).toBe(hash2)
    })

    it('should produce same hash for deltas differing only in bracket content', () => {
        const node1: GraphNode = makeNode({ contentWithoutYamlOrLinks: 'Hello [link1]* world' })
        const node2: GraphNode = makeNode({ contentWithoutYamlOrLinks: 'Hello [different_link]* world' })

        const hash1: string = hashGraphDelta([makeUpsertDelta(node1)])
        const hash2: string = hashGraphDelta([makeUpsertDelta(node2)])

        expect(hash1).toBe(hash2)
    })

    it('should produce different hash for deltas with different actual content', () => {
        const node1: GraphNode = makeNode({ contentWithoutYamlOrLinks: 'Hello world' })
        const node2: GraphNode = makeNode({ contentWithoutYamlOrLinks: 'Goodbye world' })

        const hash1: string = hashGraphDelta([makeUpsertDelta(node1)])
        const hash2: string = hashGraphDelta([makeUpsertDelta(node2)])

        expect(hash1).not.toBe(hash2)
    })

    it('should produce different hash for deltas with different node IDs', () => {
        const node1: GraphNode = makeNode({ relativeFilePathIsID: 'file1.md' })
        const node2: GraphNode = makeNode({ relativeFilePathIsID: 'file2.md' })

        const hash1: string = hashGraphDelta([makeUpsertDelta(node1)])
        const hash2: string = hashGraphDelta([makeUpsertDelta(node2)])

        expect(hash1).not.toBe(hash2)
    })

    it('should handle DeleteNode deltas', () => {
        const delta1: GraphDelta = [{ type: 'DeleteNode', nodeId: 'test.md', deletedNode: O.none }]
        const delta2: GraphDelta = [{ type: 'DeleteNode', nodeId: 'test.md', deletedNode: O.none }]
        const delta3: GraphDelta = [{ type: 'DeleteNode', nodeId: 'other.md', deletedNode: O.none }]

        expect(hashGraphDelta(delta1)).toBe(hashGraphDelta(delta2))
        expect(hashGraphDelta(delta1)).not.toBe(hashGraphDelta(delta3))
    })

    it('should produce same hash for deltas differing only in previousNode', () => {
        const node: GraphNode = makeNode()
        const previousNode: GraphNode = makeNode({ contentWithoutYamlOrLinks: 'Old content' })

        const delta1: GraphDelta = [makeUpsertDelta(node, O.none)]
        const delta2: GraphDelta = [makeUpsertDelta(node, O.some(previousNode))]

        expect(hashGraphDelta(delta1)).toBe(hashGraphDelta(delta2))
    })
})

describe('compareDeltasForDebugging', () => {
    it('should return matching: true for identical deltas', () => {
        const node: GraphNode = makeNode()
        const delta: GraphDelta = [makeUpsertDelta(node)]

        const result: ReturnType<typeof compareDeltasForDebugging> = compareDeltasForDebugging(delta, delta)

        expect(result.matching).toBe(true)
    })

    it('should identify differences in node content', () => {
        const node1: GraphNode = makeNode({ contentWithoutYamlOrLinks: 'Content A' })
        const node2: GraphNode = makeNode({ contentWithoutYamlOrLinks: 'Content B' })
        const delta1: GraphDelta = [makeUpsertDelta(node1)]
        const delta2: GraphDelta = [makeUpsertDelta(node2)]

        const result: ReturnType<typeof compareDeltasForDebugging> = compareDeltasForDebugging(delta1, delta2)

        expect(result.matching).toBe(false)
        if (!result.matching) {
            const contentDiff: typeof result.differences[number] | undefined = result.differences.find(d => d.path.includes('contentWithoutYamlOrLinks'))
            expect(contentDiff).toBeDefined()
        }
    })

    it('should identify differences in node ID', () => {
        const node1: GraphNode = makeNode({ relativeFilePathIsID: 'file1.md' })
        const node2: GraphNode = makeNode({ relativeFilePathIsID: 'file2.md' })
        const delta1: GraphDelta = [makeUpsertDelta(node1)]
        const delta2: GraphDelta = [makeUpsertDelta(node2)]

        const result: ReturnType<typeof compareDeltasForDebugging> = compareDeltasForDebugging(delta1, delta2)

        expect(result.matching).toBe(false)
        if (!result.matching) {
            const idDiff: typeof result.differences[number] | undefined = result.differences.find(d => d.path.includes('relativeFilePathIsID'))
            expect(idDiff).toBeDefined()
        }
    })

    it('should ignore position differences (normalized away)', () => {
        const node1: GraphNode = makeNode({
            nodeUIMetadata: {
                color: O.none,
                position: O.some({ x: 100, y: 200 }),
                additionalYAMLProps: new Map()
            }
        })
        const node2: GraphNode = makeNode({
            nodeUIMetadata: {
                color: O.none,
                position: O.some({ x: 999, y: 888 }),
                additionalYAMLProps: new Map()
            }
        })
        const delta1: GraphDelta = [makeUpsertDelta(node1)]
        const delta2: GraphDelta = [makeUpsertDelta(node2)]

        const result: ReturnType<typeof compareDeltasForDebugging> = compareDeltasForDebugging(delta1, delta2)

        expect(result.matching).toBe(true)
    })

    it('should ignore previousNode differences (normalized away)', () => {
        const node: GraphNode = makeNode()
        const previousNode: GraphNode = makeNode({ contentWithoutYamlOrLinks: 'Old content' })
        const delta1: GraphDelta = [makeUpsertDelta(node, O.none)]
        const delta2: GraphDelta = [makeUpsertDelta(node, O.some(previousNode))]

        const result: ReturnType<typeof compareDeltasForDebugging> = compareDeltasForDebugging(delta1, delta2)

        expect(result.matching).toBe(true)
    })
})

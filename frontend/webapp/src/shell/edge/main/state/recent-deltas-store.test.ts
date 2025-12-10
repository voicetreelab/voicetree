import { describe, it, expect, beforeEach } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import type { NodeDelta, GraphDelta, GraphNode, NodeUIMetadata } from '@/pure/graph'
import {
    markRecentDelta,
    isOurRecentDelta,
    clearRecentDeltas,
    getRecentDeltasCount,
    getRecentDeltasForNodeId
} from './recent-deltas-store'

const makeNode: (nodeId: string, content: string) => GraphNode = (nodeId, content) => ({
    relativeFilePathIsID: nodeId,
    contentWithoutYamlOrLinks: content,
    outgoingEdges: [],
    nodeUIMetadata: {
        color: O.none,
        position: O.none,
        additionalYAMLProps: new Map()
    } as NodeUIMetadata
})

const makeUpsertDelta: (nodeId: string, content: string) => NodeDelta = (nodeId, content) => ({
    type: 'UpsertNode',
    nodeToUpsert: makeNode(nodeId, content),
    previousNode: O.none
})

const makeDeleteDelta: (nodeId: string) => NodeDelta = (nodeId) => ({
    type: 'DeleteNode',
    nodeId,
    deletedNode: O.none
})

// Helper to create a GraphDelta from a single NodeDelta
const toGraphDelta: (delta: NodeDelta) => GraphDelta = (delta) => [delta]

describe('recent-deltas-store', () => {
    beforeEach(() => {
        clearRecentDeltas()
    })

    describe('markRecentDelta + isOurRecentDelta for upserts', () => {
        it('should return true for recently marked upsert delta', () => {
            const delta: NodeDelta = makeUpsertDelta('test-node', 'hello world')
            markRecentDelta(delta)

            // Incoming delta with same content
            const incomingDelta: GraphDelta = toGraphDelta(makeUpsertDelta('test-node', 'hello world'))
            expect(isOurRecentDelta(incomingDelta)).toBe(true)
        })

        it('should return false for different content', () => {
            const delta: NodeDelta = makeUpsertDelta('test-node', 'hello world')
            markRecentDelta(delta)

            const incomingDelta: GraphDelta = toGraphDelta(makeUpsertDelta('test-node', 'different content'))
            expect(isOurRecentDelta(incomingDelta)).toBe(false)
        })

        it('should return false for unknown nodeId', () => {
            const incomingDelta: GraphDelta = toGraphDelta(makeUpsertDelta('unknown', 'content'))
            expect(isOurRecentDelta(incomingDelta)).toBe(false)
        })
    })

    describe('markRecentDelta + isOurRecentDelta for deletes', () => {
        it('should return true for recently marked delete delta', () => {
            const delta: NodeDelta = makeDeleteDelta('test-node')
            markRecentDelta(delta)

            const incomingDelta: GraphDelta = toGraphDelta(makeDeleteDelta('test-node'))
            expect(isOurRecentDelta(incomingDelta)).toBe(true)
        })

        it('should return false for delete event when only upsert was marked', () => {
            const delta: NodeDelta = makeUpsertDelta('test-node', 'content')
            markRecentDelta(delta)

            const incomingDelta: GraphDelta = toGraphDelta(makeDeleteDelta('test-node'))
            expect(isOurRecentDelta(incomingDelta)).toBe(false)
        })

        it('should return false for upsert event when only delete was marked', () => {
            const delta: NodeDelta = makeDeleteDelta('test-node')
            markRecentDelta(delta)

            const incomingDelta: GraphDelta = toGraphDelta(makeUpsertDelta('test-node', 'content'))
            expect(isOurRecentDelta(incomingDelta)).toBe(false)
        })
    })

    describe('content normalization (strips brackets + whitespace)', () => {
        it('should match content ignoring whitespace differences', () => {
            const delta: NodeDelta = makeUpsertDelta('test-node', 'hello world')
            markRecentDelta(delta)

            expect(isOurRecentDelta(
                toGraphDelta(makeUpsertDelta('test-node', 'hello  world'))
            )).toBe(true)

            expect(isOurRecentDelta(
                toGraphDelta(makeUpsertDelta('test-node', 'helloworld'))
            )).toBe(true)
        })

        it('should match content ignoring bracket content', () => {
            const delta: NodeDelta = makeUpsertDelta('test-node', 'text more')
            markRecentDelta(delta)

            expect(isOurRecentDelta(
                toGraphDelta(makeUpsertDelta('test-node', 'text [link.md] more'))
            )).toBe(true)
        })
    })

    describe('TTL expiration', () => {
        it('should return false after TTL expires', async () => {
            const delta: NodeDelta = makeUpsertDelta('test-node', 'content')
            markRecentDelta(delta)

            await new Promise(r => setTimeout(r, 350))

            const incomingDelta: GraphDelta = toGraphDelta(makeUpsertDelta('test-node', 'content'))
            expect(isOurRecentDelta(incomingDelta)).toBe(false)
        })

        it('should return true within TTL window', async () => {
            const delta: NodeDelta = makeUpsertDelta('test-node', 'content')
            markRecentDelta(delta)

            await new Promise(r => setTimeout(r, 50))

            const incomingDelta: GraphDelta = toGraphDelta(makeUpsertDelta('test-node', 'content'))
            expect(isOurRecentDelta(incomingDelta)).toBe(true)
        })
    })

    describe('multiple events handling (no consume on match)', () => {
        it('should allow multiple isOurRecentDelta calls to match same mark', () => {
            const delta: NodeDelta = makeUpsertDelta('test-node', 'content')
            markRecentDelta(delta)

            const incomingDelta: GraphDelta = toGraphDelta(makeUpsertDelta('test-node', 'content'))
            expect(isOurRecentDelta(incomingDelta)).toBe(true)
            expect(isOurRecentDelta(incomingDelta)).toBe(true)
            expect(isOurRecentDelta(incomingDelta)).toBe(true)
        })
    })

    describe('multiple deltas for same nodeId', () => {
        it('should track multiple marks for same nodeId', () => {
            const delta1: NodeDelta = makeUpsertDelta('test-node', 'first')
            const delta2: NodeDelta = makeUpsertDelta('test-node', 'second')
            markRecentDelta(delta1)
            markRecentDelta(delta2)

            expect(isOurRecentDelta(
                toGraphDelta(makeUpsertDelta('test-node', 'first'))
            )).toBe(true)

            expect(isOurRecentDelta(
                toGraphDelta(makeUpsertDelta('test-node', 'second'))
            )).toBe(true)
        })
    })

    describe('multiple nodeIds', () => {
        it('should track nodeIds independently', () => {
            markRecentDelta(makeUpsertDelta('node1', 'content1'))
            markRecentDelta(makeUpsertDelta('node2', 'content2'))

            expect(isOurRecentDelta(
                toGraphDelta(makeUpsertDelta('node1', 'content1'))
            )).toBe(true)

            expect(isOurRecentDelta(
                toGraphDelta(makeUpsertDelta('node2', 'content2'))
            )).toBe(true)
        })

        it('should not cross-match nodeIds', () => {
            markRecentDelta(makeUpsertDelta('node1', 'content'))

            expect(isOurRecentDelta(
                toGraphDelta(makeUpsertDelta('node2', 'content'))
            )).toBe(false)
        })
    })

    describe('GraphDelta with multiple NodeDeltas', () => {
        it('should return true only if ALL deltas match our recent writes', () => {
            markRecentDelta(makeUpsertDelta('node1', 'content1'))
            markRecentDelta(makeUpsertDelta('node2', 'content2'))

            // Both match
            const bothMatch: GraphDelta = [
                makeUpsertDelta('node1', 'content1'),
                makeUpsertDelta('node2', 'content2')
            ]
            expect(isOurRecentDelta(bothMatch)).toBe(true)
        })

        it('should return false if any delta does not match', () => {
            markRecentDelta(makeUpsertDelta('node1', 'content1'))

            // First matches, second doesn't exist
            const partialMatch: GraphDelta = [
                makeUpsertDelta('node1', 'content1'),
                makeUpsertDelta('node2', 'content2')
            ]
            expect(isOurRecentDelta(partialMatch)).toBe(false)
        })

        it('should return true for empty GraphDelta', () => {
            const emptyDelta: GraphDelta = []
            expect(isOurRecentDelta(emptyDelta)).toBe(true)
        })
    })

    describe('clearRecentDeltas', () => {
        it('should remove all entries', () => {
            markRecentDelta(makeUpsertDelta('node1', 'content1'))
            markRecentDelta(makeUpsertDelta('node2', 'content2'))
            clearRecentDeltas()

            expect(isOurRecentDelta(
                toGraphDelta(makeUpsertDelta('node1', 'content1'))
            )).toBe(false)

            expect(isOurRecentDelta(
                toGraphDelta(makeUpsertDelta('node2', 'content2'))
            )).toBe(false)
        })
    })

    describe('debugging helpers', () => {
        it('getRecentDeltasCount should return number of tracked nodeIds', () => {
            expect(getRecentDeltasCount()).toBe(0)
            markRecentDelta(makeUpsertDelta('node1', 'content'))
            expect(getRecentDeltasCount()).toBe(1)
            markRecentDelta(makeUpsertDelta('node2', 'content'))
            expect(getRecentDeltasCount()).toBe(2)
        })

        it('getRecentDeltasForNodeId should return entries', () => {
            markRecentDelta(makeUpsertDelta('node1', 'content1'))
            markRecentDelta(makeUpsertDelta('node1', 'content2'))

            const entries: readonly { readonly delta: NodeDelta; readonly timestamp: number }[] | undefined = getRecentDeltasForNodeId('node1')
            expect(entries).toHaveLength(2)
            expect(entries?.[0].delta.type).toBe('UpsertNode')
            expect(entries?.[1].delta.type).toBe('UpsertNode')
        })

        it('getRecentDeltasForNodeId should return undefined for unknown nodeId', () => {
            expect(getRecentDeltasForNodeId('unknown')).toBeUndefined()
        })
    })
})

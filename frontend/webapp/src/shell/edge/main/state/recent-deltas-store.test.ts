import { describe, it, expect, beforeEach } from 'vitest'
import * as O from 'fp-ts/Option'
import type { NodeDelta, FSEvent, GraphNode, NodeUIMetadata } from '@/pure/graph'
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

const makeUpsertFSEvent: (absolutePath: string, content: string) => FSEvent = (absolutePath, content) => ({
    absolutePath,
    content,
    eventType: 'Changed'
})

const makeDeleteFSEvent: (absolutePath: string) => FSEvent = (absolutePath) => ({
    type: 'Delete',
    absolutePath
})

const WATCHED_DIR: string = '/vault'

// Helper to wrap content with empty frontmatter (matches what fromNodeToMarkdownContent produces)
const withFrontmatter: (content: string) => string = (content) => `---\n---\n${content}`

describe('recent-deltas-store', () => {
    beforeEach(() => {
        clearRecentDeltas()
    })

    describe('markRecentDelta + isOurRecentDelta for upserts', () => {
        it('should return true for recently marked upsert delta', () => {
            const delta: NodeDelta = makeUpsertDelta('test-node', 'hello world')
            markRecentDelta(delta)

            // FS event content includes frontmatter (like real markdown files)
            const fsEvent: FSEvent = makeUpsertFSEvent('/vault/test-node.md', withFrontmatter('hello world'))
            expect(isOurRecentDelta(fsEvent, WATCHED_DIR)).toBe(true)
        })

        it('should return false for different content', () => {
            const delta: NodeDelta = makeUpsertDelta('test-node', 'hello world')
            markRecentDelta(delta)

            const fsEvent: FSEvent = makeUpsertFSEvent('/vault/test-node.md', withFrontmatter('different content'))
            expect(isOurRecentDelta(fsEvent, WATCHED_DIR)).toBe(false)
        })

        it('should return false for unknown nodeId', () => {
            const fsEvent: FSEvent = makeUpsertFSEvent('/vault/unknown.md', withFrontmatter('content'))
            expect(isOurRecentDelta(fsEvent, WATCHED_DIR)).toBe(false)
        })
    })

    describe('markRecentDelta + isOurRecentDelta for deletes', () => {
        it('should return true for recently marked delete delta', () => {
            const delta: NodeDelta = makeDeleteDelta('test-node')
            markRecentDelta(delta)

            const fsEvent: FSEvent = makeDeleteFSEvent('/vault/test-node.md')
            expect(isOurRecentDelta(fsEvent, WATCHED_DIR)).toBe(true)
        })

        it('should return false for delete event when only upsert was marked', () => {
            const delta: NodeDelta = makeUpsertDelta('test-node', 'content')
            markRecentDelta(delta)

            const fsEvent: FSEvent = makeDeleteFSEvent('/vault/test-node.md')
            expect(isOurRecentDelta(fsEvent, WATCHED_DIR)).toBe(false)
        })

        it('should return false for upsert event when only delete was marked', () => {
            const delta: NodeDelta = makeDeleteDelta('test-node')
            markRecentDelta(delta)

            const fsEvent: FSEvent = makeUpsertFSEvent('/vault/test-node.md', withFrontmatter('content'))
            expect(isOurRecentDelta(fsEvent, WATCHED_DIR)).toBe(false)
        })
    })

    describe('content normalization (strips brackets + whitespace)', () => {
        it('should match content ignoring whitespace differences', () => {
            const delta: NodeDelta = makeUpsertDelta('test-node', 'hello world')
            markRecentDelta(delta)

            expect(isOurRecentDelta(
                makeUpsertFSEvent('/vault/test-node.md', withFrontmatter('hello  world')),
                WATCHED_DIR
            )).toBe(true)

            expect(isOurRecentDelta(
                makeUpsertFSEvent('/vault/test-node.md', withFrontmatter('helloworld')),
                WATCHED_DIR
            )).toBe(true)
        })

        it('should match content ignoring bracket content', () => {
            const delta: NodeDelta = makeUpsertDelta('test-node', 'text more')
            markRecentDelta(delta)

            expect(isOurRecentDelta(
                makeUpsertFSEvent('/vault/test-node.md', withFrontmatter('text [link.md] more')),
                WATCHED_DIR
            )).toBe(true)
        })
    })

    describe('TTL expiration', () => {
        it('should return false after TTL expires', async () => {
            const delta: NodeDelta = makeUpsertDelta('test-node', 'content')
            markRecentDelta(delta)

            await new Promise(r => setTimeout(r, 350))

            const fsEvent: FSEvent = makeUpsertFSEvent('/vault/test-node.md', withFrontmatter('content'))
            expect(isOurRecentDelta(fsEvent, WATCHED_DIR)).toBe(false)
        })

        it('should return true within TTL window', async () => {
            const delta: NodeDelta = makeUpsertDelta('test-node', 'content')
            markRecentDelta(delta)

            await new Promise(r => setTimeout(r, 50))

            const fsEvent: FSEvent = makeUpsertFSEvent('/vault/test-node.md', withFrontmatter('content'))
            expect(isOurRecentDelta(fsEvent, WATCHED_DIR)).toBe(true)
        })
    })

    describe('multiple events handling (no consume on match)', () => {
        it('should allow multiple isOurRecentDelta calls to match same mark', () => {
            const delta: NodeDelta = makeUpsertDelta('test-node', 'content')
            markRecentDelta(delta)

            const fsEvent: FSEvent = makeUpsertFSEvent('/vault/test-node.md', withFrontmatter('content'))
            expect(isOurRecentDelta(fsEvent, WATCHED_DIR)).toBe(true)
            expect(isOurRecentDelta(fsEvent, WATCHED_DIR)).toBe(true)
            expect(isOurRecentDelta(fsEvent, WATCHED_DIR)).toBe(true)
        })
    })

    describe('multiple deltas for same nodeId', () => {
        it('should track multiple marks for same nodeId', () => {
            const delta1: NodeDelta = makeUpsertDelta('test-node', 'first')
            const delta2: NodeDelta = makeUpsertDelta('test-node', 'second')
            markRecentDelta(delta1)
            markRecentDelta(delta2)

            expect(isOurRecentDelta(
                makeUpsertFSEvent('/vault/test-node.md', withFrontmatter('first')),
                WATCHED_DIR
            )).toBe(true)

            expect(isOurRecentDelta(
                makeUpsertFSEvent('/vault/test-node.md', withFrontmatter('second')),
                WATCHED_DIR
            )).toBe(true)
        })
    })

    describe('multiple nodeIds', () => {
        it('should track nodeIds independently', () => {
            markRecentDelta(makeUpsertDelta('node1', 'content1'))
            markRecentDelta(makeUpsertDelta('node2', 'content2'))

            expect(isOurRecentDelta(
                makeUpsertFSEvent('/vault/node1.md', withFrontmatter('content1')),
                WATCHED_DIR
            )).toBe(true)

            expect(isOurRecentDelta(
                makeUpsertFSEvent('/vault/node2.md', withFrontmatter('content2')),
                WATCHED_DIR
            )).toBe(true)
        })

        it('should not cross-match nodeIds', () => {
            markRecentDelta(makeUpsertDelta('node1', 'content'))

            expect(isOurRecentDelta(
                makeUpsertFSEvent('/vault/node2.md', withFrontmatter('content')),
                WATCHED_DIR
            )).toBe(false)
        })
    })

    describe('clearRecentDeltas', () => {
        it('should remove all entries', () => {
            markRecentDelta(makeUpsertDelta('node1', 'content1'))
            markRecentDelta(makeUpsertDelta('node2', 'content2'))
            clearRecentDeltas()

            expect(isOurRecentDelta(
                makeUpsertFSEvent('/vault/node1.md', withFrontmatter('content1')),
                WATCHED_DIR
            )).toBe(false)

            expect(isOurRecentDelta(
                makeUpsertFSEvent('/vault/node2.md', withFrontmatter('content2')),
                WATCHED_DIR
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

            const entries: readonly { readonly delta: NodeDelta; readonly markdownContent: string | null; readonly timestamp: number }[] | undefined = getRecentDeltasForNodeId('node1')
            expect(entries).toHaveLength(2)
            expect(entries?.[0].delta.type).toBe('UpsertNode')
            expect(entries?.[1].delta.type).toBe('UpsertNode')
        })

        it('getRecentDeltasForNodeId should return undefined for unknown nodeId', () => {
            expect(getRecentDeltasForNodeId('unknown')).toBeUndefined()
        })
    })
})

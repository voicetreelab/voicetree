import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import {
    extractRecentNodesFromDelta,
    addEntriesToHistory,
    removeNodeFromHistory,
    updateHistoryFromDelta,
    createEmptyHistory,
    type RecentNodeHistory
} from './recentNodeHistoryV2'
import type { GraphDelta, GraphNode, UpsertNodeDelta, DeleteNode } from '@/pure/graph'

// Helper to create a minimal GraphNode for testing
function createTestNode(id: string, title: string, contentExtra: string = ''): GraphNode {
    return {
        relativeFilePathIsID: id,
        contentWithoutYamlOrLinks: `# ${title}\n\nSome content${contentExtra}`,
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map()
        }
    }
}

function createUpsertAction(id: string, title: string, previousNode?: GraphNode): UpsertNodeDelta {
    return {
        type: 'UpsertNode',
        nodeToUpsert: createTestNode(id, title),
        previousNode
    }
}

function createDeleteAction(id: string): DeleteNode {
    return {
        type: 'DeleteNode',
        nodeId: id
    }
}

// Helper to get nodeId from an UpsertNodeDelta
function getNodeId(entry: UpsertNodeDelta): string {
    return entry.nodeToUpsert.relativeFilePathIsID
}

describe('recentNodeHistoryV2', () => {
    describe('createEmptyHistory', () => {
        it('returns empty array', () => {
            const history: RecentNodeHistory = createEmptyHistory()
            expect(history).toEqual([])
        })
    })

    describe('extractRecentNodesFromDelta', () => {
        it('extracts UpsertNode actions directly', () => {
            const delta: GraphDelta = [
                createUpsertAction('note1.md', 'First Note'),
                createUpsertAction('note2.md', 'Second Note')
            ]

            const entries: readonly UpsertNodeDelta[] = extractRecentNodesFromDelta(delta)

            expect(entries).toHaveLength(2)
            expect(getNodeId(entries[0])).toBe('note1.md')
            expect(getNodeId(entries[1])).toBe('note2.md')
        })

        it('ignores DeleteNode actions', () => {
            const delta: GraphDelta = [
                createUpsertAction('note1.md', 'First Note'),
                createDeleteAction('deleted.md'),
                createUpsertAction('note2.md', 'Second Note')
            ]

            const entries: readonly UpsertNodeDelta[] = extractRecentNodesFromDelta(delta)

            expect(entries).toHaveLength(2)
            expect(entries.map(e => getNodeId(e))).toEqual(['note1.md', 'note2.md'])
        })

        it('returns empty array for empty delta', () => {
            const entries: readonly UpsertNodeDelta[] = extractRecentNodesFromDelta([])
            expect(entries).toEqual([])
        })

        it('returns empty array for delta with only deletions', () => {
            const delta: GraphDelta = [
                createDeleteAction('note1.md'),
                createDeleteAction('note2.md')
            ]

            const entries: readonly UpsertNodeDelta[] = extractRecentNodesFromDelta(delta)
            expect(entries).toEqual([])
        })

        it('includes new nodes (previousNode undefined)', () => {
            const delta: GraphDelta = [
                createUpsertAction('new.md', 'New Node', undefined)
            ]

            const entries: readonly UpsertNodeDelta[] = extractRecentNodesFromDelta(delta)
            expect(entries).toHaveLength(1)
            expect(getNodeId(entries[0])).toBe('new.md')
        })

        it('includes nodes with significant content changes (150+ chars)', () => {
            const previousNode: GraphNode = createTestNode('edit.md', 'Old Title')
            // Add 200 chars to make the content change significant
            const extraContent: string = 'x'.repeat(200)
            const delta: GraphDelta = [{
                type: 'UpsertNode',
                nodeToUpsert: createTestNode('edit.md', 'New Title', extraContent),
                previousNode
            }]

            const entries: readonly UpsertNodeDelta[] = extractRecentNodesFromDelta(delta)
            expect(entries).toHaveLength(1)
            expect(getNodeId(entries[0])).toBe('edit.md')
        })

        it('excludes edge-only changes (same content)', () => {
            const previousNode: GraphNode = createTestNode('edge-only.md', 'Same Title')
            // Create action with same content as previousNode
            const action: UpsertNodeDelta = {
                type: 'UpsertNode',
                nodeToUpsert: createTestNode('edge-only.md', 'Same Title'),
                previousNode
            }
            const delta: GraphDelta = [action]

            const entries: readonly UpsertNodeDelta[] = extractRecentNodesFromDelta(delta)
            expect(entries).toHaveLength(0)
        })

        it('filters mixed delta correctly', () => {
            const previousNodeWithChange: GraphNode = createTestNode('changed.md', 'Old Content')
            const previousNodeWithoutChange: GraphNode = createTestNode('unchanged.md', 'Same')
            const extraContent: string = 'y'.repeat(200)

            const delta: GraphDelta = [
                createUpsertAction('new.md', 'New Node', undefined),
                {
                    type: 'UpsertNode',
                    nodeToUpsert: createTestNode('changed.md', 'New Content', extraContent),
                    previousNode: previousNodeWithChange
                },
                {
                    type: 'UpsertNode',
                    nodeToUpsert: createTestNode('unchanged.md', 'Same'),
                    previousNode: previousNodeWithoutChange
                },
                createDeleteAction('deleted.md')
            ]

            const entries: readonly UpsertNodeDelta[] = extractRecentNodesFromDelta(delta)
            expect(entries).toHaveLength(2)
            expect(entries.map(e => getNodeId(e))).toEqual(['new.md', 'changed.md'])
        })
    })

    describe('addEntriesToHistory', () => {
        it('adds entries to front of history', () => {
            const existing: RecentNodeHistory = [
                createUpsertAction('old.md', 'Old')
            ]
            const newEntries: readonly UpsertNodeDelta[] = [
                createUpsertAction('new.md', 'New')
            ]

            const result: RecentNodeHistory = addEntriesToHistory(existing, newEntries)

            expect(getNodeId(result[0])).toBe('new.md')
            expect(getNodeId(result[1])).toBe('old.md')
        })

        it('moves existing node to front when re-added', () => {
            const existing: RecentNodeHistory = [
                createUpsertAction('a.md', 'A'),
                createUpsertAction('b.md', 'B'),
                createUpsertAction('c.md', 'C')
            ]
            const newEntries: readonly UpsertNodeDelta[] = [
                createUpsertAction('c.md', 'C Updated')
            ]

            const result: RecentNodeHistory = addEntriesToHistory(existing, newEntries)

            expect(result).toHaveLength(3)
            expect(getNodeId(result[0])).toBe('c.md')
            expect(getNodeId(result[1])).toBe('a.md')
            expect(getNodeId(result[2])).toBe('b.md')
        })

        it('trims history to max 5 entries', () => {
            const existing: RecentNodeHistory = [
                createUpsertAction('1.md', '1'),
                createUpsertAction('2.md', '2'),
                createUpsertAction('3.md', '3'),
                createUpsertAction('4.md', '4'),
                createUpsertAction('5.md', '5')
            ]
            const newEntries: readonly UpsertNodeDelta[] = [
                createUpsertAction('new.md', 'New')
            ]

            const result: RecentNodeHistory = addEntriesToHistory(existing, newEntries)

            expect(result).toHaveLength(5)
            expect(getNodeId(result[0])).toBe('new.md')
            expect(getNodeId(result[4])).toBe('4.md') // '5.md' was pushed out
        })

        it('handles empty history', () => {
            const newEntries: readonly UpsertNodeDelta[] = [
                createUpsertAction('first.md', 'First')
            ]

            const result: RecentNodeHistory = addEntriesToHistory([], newEntries)

            expect(result).toHaveLength(1)
            expect(getNodeId(result[0])).toBe('first.md')
        })

        it('handles empty new entries', () => {
            const existing: RecentNodeHistory = [
                createUpsertAction('a.md', 'A')
            ]

            const result: RecentNodeHistory = addEntriesToHistory(existing, [])

            expect(result).toEqual(existing)
        })
    })

    describe('removeNodeFromHistory', () => {
        it('removes node by id', () => {
            const history: RecentNodeHistory = [
                createUpsertAction('a.md', 'A'),
                createUpsertAction('b.md', 'B')
            ]

            const result: RecentNodeHistory = removeNodeFromHistory(history, 'a.md')

            expect(result).toHaveLength(1)
            expect(getNodeId(result[0])).toBe('b.md')
        })

        it('returns same array if node not found', () => {
            const history: RecentNodeHistory = [
                createUpsertAction('a.md', 'A')
            ]

            const result: RecentNodeHistory = removeNodeFromHistory(history, 'nonexistent.md')

            expect(result).toHaveLength(1)
            expect(getNodeId(result[0])).toBe('a.md')
        })
    })

    describe('updateHistoryFromDelta', () => {
        it('adds new nodes and removes deleted nodes', () => {
            const history: RecentNodeHistory = [
                createUpsertAction('old.md', 'Old'),
                createUpsertAction('toDelete.md', 'To Delete')
            ]
            const delta: GraphDelta = [
                createUpsertAction('new.md', 'New Note'),
                createDeleteAction('toDelete.md')
            ]

            const result: RecentNodeHistory = updateHistoryFromDelta(history, delta)

            expect(result).toHaveLength(2)
            expect(result.map(e => getNodeId(e))).toEqual(['new.md', 'old.md'])
        })

        it('handles delta with only upserts', () => {
            const history: RecentNodeHistory = []
            const delta: GraphDelta = [
                createUpsertAction('a.md', 'A'),
                createUpsertAction('b.md', 'B')
            ]

            const result: RecentNodeHistory = updateHistoryFromDelta(history, delta)

            expect(result).toHaveLength(2)
            expect(getNodeId(result[0])).toBe('b.md') // Last upsert is at front
            expect(getNodeId(result[1])).toBe('a.md')
        })

        it('handles delta with only deletions', () => {
            const history: RecentNodeHistory = [
                createUpsertAction('a.md', 'A'),
                createUpsertAction('b.md', 'B')
            ]
            const delta: GraphDelta = [
                createDeleteAction('a.md')
            ]

            const result: RecentNodeHistory = updateHistoryFromDelta(history, delta)

            expect(result).toHaveLength(1)
            expect(getNodeId(result[0])).toBe('b.md')
        })
    })
})

import { describe, it, expect } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import {
    extractRecentNodesFromDelta,
    addEntriesToHistory,
    removeNodeFromHistory,
    updateHistoryFromDelta,
    createEmptyHistory,
    type RecentNodeHistory,
    type RecentNodeEntry
} from './recentNodeHistoryV2'
import type { GraphDelta, GraphNode, UpsertNodeAction, DeleteNode } from '@/pure/graph'

// Helper to create a minimal GraphNode for testing
function createTestNode(id: string, title: string): GraphNode {
    return {
        relativeFilePathIsID: id,
        contentWithoutYamlOrLinks: `# ${title}\n\nSome content`,
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map()
        }
    }
}

function createUpsertAction(id: string, title: string): UpsertNodeAction {
    return {
        type: 'UpsertNode',
        nodeToUpsert: createTestNode(id, title)
    }
}

function createDeleteAction(id: string): DeleteNode {
    return {
        type: 'DeleteNode',
        nodeId: id
    }
}

describe('recentNodeHistoryV2', () => {
    describe('createEmptyHistory', () => {
        it('returns empty array', () => {
            const history = createEmptyHistory()
            expect(history).toEqual([])
        })
    })

    describe('extractRecentNodesFromDelta', () => {
        it('extracts UpsertNode actions as RecentNodeEntry', () => {
            const delta: GraphDelta = [
                createUpsertAction('note1.md', 'First Note'),
                createUpsertAction('note2.md', 'Second Note')
            ]

            const entries = extractRecentNodesFromDelta(delta)

            expect(entries).toHaveLength(2)
            expect(entries[0].nodeId).toBe('note1.md')
            expect(entries[0].label).toBe('First Note')
            expect(entries[1].nodeId).toBe('note2.md')
            expect(entries[1].label).toBe('Second Note')
        })

        it('ignores DeleteNode actions', () => {
            const delta: GraphDelta = [
                createUpsertAction('note1.md', 'First Note'),
                createDeleteAction('deleted.md'),
                createUpsertAction('note2.md', 'Second Note')
            ]

            const entries = extractRecentNodesFromDelta(delta)

            expect(entries).toHaveLength(2)
            expect(entries.map(e => e.nodeId)).toEqual(['note1.md', 'note2.md'])
        })

        it('returns empty array for empty delta', () => {
            const entries = extractRecentNodesFromDelta([])
            expect(entries).toEqual([])
        })

        it('returns empty array for delta with only deletions', () => {
            const delta: GraphDelta = [
                createDeleteAction('note1.md'),
                createDeleteAction('note2.md')
            ]

            const entries = extractRecentNodesFromDelta(delta)
            expect(entries).toEqual([])
        })
    })

    describe('addEntriesToHistory', () => {
        it('adds entries to front of history', () => {
            const existing: RecentNodeHistory = [
                { nodeId: 'old.md', label: 'Old', timestamp: 1000 }
            ]
            const newEntries: RecentNodeEntry[] = [
                { nodeId: 'new.md', label: 'New', timestamp: 2000 }
            ]

            const result = addEntriesToHistory(existing, newEntries)

            expect(result[0].nodeId).toBe('new.md')
            expect(result[1].nodeId).toBe('old.md')
        })

        it('moves existing node to front when re-added', () => {
            const existing: RecentNodeHistory = [
                { nodeId: 'a.md', label: 'A', timestamp: 1000 },
                { nodeId: 'b.md', label: 'B', timestamp: 900 },
                { nodeId: 'c.md', label: 'C', timestamp: 800 }
            ]
            const newEntries: RecentNodeEntry[] = [
                { nodeId: 'c.md', label: 'C Updated', timestamp: 2000 }
            ]

            const result = addEntriesToHistory(existing, newEntries)

            expect(result).toHaveLength(3)
            expect(result[0].nodeId).toBe('c.md')
            expect(result[0].label).toBe('C Updated')
            expect(result[1].nodeId).toBe('a.md')
            expect(result[2].nodeId).toBe('b.md')
        })

        it('trims history to max 5 entries', () => {
            const existing: RecentNodeHistory = [
                { nodeId: '1.md', label: '1', timestamp: 1000 },
                { nodeId: '2.md', label: '2', timestamp: 900 },
                { nodeId: '3.md', label: '3', timestamp: 800 },
                { nodeId: '4.md', label: '4', timestamp: 700 },
                { nodeId: '5.md', label: '5', timestamp: 600 }
            ]
            const newEntries: RecentNodeEntry[] = [
                { nodeId: 'new.md', label: 'New', timestamp: 2000 }
            ]

            const result = addEntriesToHistory(existing, newEntries)

            expect(result).toHaveLength(5)
            expect(result[0].nodeId).toBe('new.md')
            expect(result[4].nodeId).toBe('4.md') // '5.md' was pushed out
        })

        it('handles empty history', () => {
            const newEntries: RecentNodeEntry[] = [
                { nodeId: 'first.md', label: 'First', timestamp: 1000 }
            ]

            const result = addEntriesToHistory([], newEntries)

            expect(result).toHaveLength(1)
            expect(result[0].nodeId).toBe('first.md')
        })

        it('handles empty new entries', () => {
            const existing: RecentNodeHistory = [
                { nodeId: 'a.md', label: 'A', timestamp: 1000 }
            ]

            const result = addEntriesToHistory(existing, [])

            expect(result).toEqual(existing)
        })
    })

    describe('removeNodeFromHistory', () => {
        it('removes node by id', () => {
            const history: RecentNodeHistory = [
                { nodeId: 'a.md', label: 'A', timestamp: 1000 },
                { nodeId: 'b.md', label: 'B', timestamp: 900 }
            ]

            const result = removeNodeFromHistory(history, 'a.md')

            expect(result).toHaveLength(1)
            expect(result[0].nodeId).toBe('b.md')
        })

        it('returns same array if node not found', () => {
            const history: RecentNodeHistory = [
                { nodeId: 'a.md', label: 'A', timestamp: 1000 }
            ]

            const result = removeNodeFromHistory(history, 'nonexistent.md')

            expect(result).toEqual(history)
        })
    })

    describe('updateHistoryFromDelta', () => {
        it('adds new nodes and removes deleted nodes', () => {
            const history: RecentNodeHistory = [
                { nodeId: 'old.md', label: 'Old', timestamp: 1000 },
                { nodeId: 'toDelete.md', label: 'To Delete', timestamp: 900 }
            ]
            const delta: GraphDelta = [
                createUpsertAction('new.md', 'New Note'),
                createDeleteAction('toDelete.md')
            ]

            const result = updateHistoryFromDelta(history, delta)

            expect(result).toHaveLength(2)
            expect(result.map(e => e.nodeId)).toEqual(['new.md', 'old.md'])
        })

        it('handles delta with only upserts', () => {
            const history: RecentNodeHistory = []
            const delta: GraphDelta = [
                createUpsertAction('a.md', 'A'),
                createUpsertAction('b.md', 'B')
            ]

            const result = updateHistoryFromDelta(history, delta)

            expect(result).toHaveLength(2)
            expect(result[0].nodeId).toBe('b.md') // Last upsert is at front
            expect(result[1].nodeId).toBe('a.md')
        })

        it('handles delta with only deletions', () => {
            const history: RecentNodeHistory = [
                { nodeId: 'a.md', label: 'A', timestamp: 1000 },
                { nodeId: 'b.md', label: 'B', timestamp: 900 }
            ]
            const delta: GraphDelta = [
                createDeleteAction('a.md')
            ]

            const result = updateHistoryFromDelta(history, delta)

            expect(result).toHaveLength(1)
            expect(result[0].nodeId).toBe('b.md')
        })
    })
})

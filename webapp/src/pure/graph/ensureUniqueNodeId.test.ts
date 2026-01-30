import { describe, it, expect } from 'vitest'
import { ensureUniqueNodeId } from './ensureUniqueNodeId'
import type { NodeIdAndFilePath } from '@/pure/graph'

describe('ensureUniqueNodeId', () => {
    it('returns candidateId when no collision exists', () => {
        const result: NodeIdAndFilePath = ensureUniqueNodeId('foo.md', new Set())
        expect(result).toBe('foo.md')
    })

    it('returns candidateId when other IDs exist but no collision', () => {
        const result: NodeIdAndFilePath = ensureUniqueNodeId('foo.md', new Set(['bar.md', 'baz.md']))
        expect(result).toBe('foo.md')
    })

    it('appends _2 suffix when candidateId already exists', () => {
        const result: NodeIdAndFilePath = ensureUniqueNodeId('foo.md', new Set(['foo.md']))
        expect(result).toBe('foo_2.md')
    })

    it('appends _3 suffix when _2 also exists', () => {
        const result: NodeIdAndFilePath = ensureUniqueNodeId('foo.md', new Set(['foo.md', 'foo_2.md']))
        expect(result).toBe('foo_3.md')
    })

    it('finds first available suffix in sequence', () => {
        const result: NodeIdAndFilePath = ensureUniqueNodeId(
            'note.md',
            new Set(['note.md', 'note_2.md', 'note_3.md', 'note_4.md'])
        )
        expect(result).toBe('note_5.md')
    })

    it('preserves folder prefix in collision handling', () => {
        const result: NodeIdAndFilePath = ensureUniqueNodeId(
            'tuesday/my_node.md',
            new Set(['tuesday/my_node.md'])
        )
        expect(result).toBe('tuesday/my_node_2.md')
    })

    it('preserves nested folder prefix', () => {
        const result: NodeIdAndFilePath = ensureUniqueNodeId(
            'vault/ctx-nodes/context_123.md',
            new Set(['vault/ctx-nodes/context_123.md', 'vault/ctx-nodes/context_123_2.md'])
        )
        expect(result).toBe('vault/ctx-nodes/context_123_3.md')
    })

    it('handles empty set of existing IDs', () => {
        const result: NodeIdAndFilePath = ensureUniqueNodeId('test.md', new Set())
        expect(result).toBe('test.md')
    })
})

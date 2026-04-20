import { describe, expect, it } from 'vitest'
import type { Graph } from '..'
import { buildGraphFromFiles } from '../buildGraphFromFiles'
import { getFolderNotePath } from './getFolderNotePath'

function buildTestGraph(files: readonly { readonly absolutePath: string; readonly content: string }[]): Graph {
    return buildGraphFromFiles(files)
}

describe('getFolderNotePath', () => {
    it('prefers index.md when both folder-note conventions exist', () => {
        const graph: Graph = buildTestGraph([
            { absolutePath: '/vault/topic/index.md', content: '# Topic Index' },
            { absolutePath: '/vault/topic/topic.md', content: '# Topic Basename' }
        ])

        expect(getFolderNotePath(graph, '/vault/topic/')).toBe('/vault/topic/index.md')
    })

    it('falls back to basename.md when index.md is absent', () => {
        const graph: Graph = buildTestGraph([
            { absolutePath: '/vault/topic/topic.md', content: '# Topic Basename' }
        ])

        expect(getFolderNotePath(graph, '/vault/topic/')).toBe('/vault/topic/topic.md')
    })

    it('returns undefined when the folder has no supported folder-note', () => {
        const graph: Graph = buildTestGraph([
            { absolutePath: '/vault/topic/child-a.md', content: '# Child A' },
            { absolutePath: '/vault/topic/child-b.md', content: '# Child B' }
        ])

        expect(getFolderNotePath(graph, '/vault/topic/')).toBeUndefined()
    })

    it('normalizes folder ids without a trailing slash', () => {
        const graph: Graph = buildTestGraph([
            { absolutePath: '/vault/topic/index.md', content: '# Topic Index' }
        ])

        expect(getFolderNotePath(graph, '/vault/topic')).toBe('/vault/topic/index.md')
    })
})

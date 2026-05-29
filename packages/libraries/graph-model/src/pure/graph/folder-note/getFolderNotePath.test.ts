import { describe, expect, it } from 'vitest'
import type { Graph } from '..'
import { buildGraphFromFiles } from '../construction/buildGraphFromFiles'
import { getFolderNotePath } from './getFolderNotePath'

function buildTestGraph(files: readonly { readonly absolutePath: string; readonly content: string }[]): Graph {
    return buildGraphFromFiles(files)
}

describe('getFolderNotePath', () => {
    it('prefers index.md when both folder-note conventions exist', () => {
        const graph: Graph = buildTestGraph([
            { absolutePath: '/project/topic/index.md', content: '# Topic Index' },
            { absolutePath: '/project/topic/topic.md', content: '# Topic Basename' }
        ])

        expect(getFolderNotePath(graph, '/project/topic/')).toBe('/project/topic/index.md')
    })

    it('falls back to basename.md when index.md is absent', () => {
        const graph: Graph = buildTestGraph([
            { absolutePath: '/project/topic/topic.md', content: '# Topic Basename' }
        ])

        expect(getFolderNotePath(graph, '/project/topic/')).toBe('/project/topic/topic.md')
    })

    it('returns undefined when the folder has no supported folder-note', () => {
        const graph: Graph = buildTestGraph([
            { absolutePath: '/project/topic/child-a.md', content: '# Child A' },
            { absolutePath: '/project/topic/child-b.md', content: '# Child B' }
        ])

        expect(getFolderNotePath(graph, '/project/topic/')).toBeUndefined()
    })

    it('normalizes folder ids without a trailing slash', () => {
        const graph: Graph = buildTestGraph([
            { absolutePath: '/project/topic/index.md', content: '# Topic Index' }
        ])

        expect(getFolderNotePath(graph, '/project/topic')).toBe('/project/topic/index.md')
    })
})

import * as O from 'fp-ts/lib/Option.js'
import { describe, expect, it } from 'vitest'

import { toAbsolutePath } from '@vt/graph-model'

import { collectFolderProjectionInfo, type FolderProjectionInfo } from '../../src/project-helpers.ts'

function makeLeafNode(nodeId: string) {
    return {
        kind: 'leaf' as const,
        outgoingEdges: [],
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: '',
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: {},
        },
    }
}

describe('collectFolderProjectionInfo memoization', () => {
    it('returns cached (reference-equal) items on second call with same inputs', () => {
        const notePath = toAbsolutePath('/tmp/project/notes/hello.md')
        const folder = {
            name: 'notes',
            absolutePath: toAbsolutePath('/tmp/project/notes'),
            loadState: 'loaded' as const,
            isWriteTarget: false,
            children: [{
                name: 'hello.md',
                absolutePath: notePath,
                isInGraph: true,
            }],
        }
        const graphNodes = { [notePath]: makeLeafNode(notePath) }

        const out1: FolderProjectionInfo[] = []
        collectFolderProjectionInfo(folder, graphNodes, undefined, out1)

        const out2: FolderProjectionInfo[] = []
        collectFolderProjectionInfo(folder, graphNodes, undefined, out2)

        expect(out1.length).toBeGreaterThan(0)
        expect(out1.length).toBe(out2.length)
        for (let i = 0; i < out1.length; i++) {
            expect(out2[i]).toBe(out1[i])
        }
    })

    it('recomputes when graphNodes reference changes', () => {
        const notePath = toAbsolutePath('/tmp/project/notes/hello.md')
        const folder = {
            name: 'notes',
            absolutePath: toAbsolutePath('/tmp/project/notes'),
            loadState: 'loaded' as const,
            isWriteTarget: false,
            children: [{
                name: 'hello.md',
                absolutePath: notePath,
                isInGraph: true,
            }],
        }
        const graphNodes1 = { [notePath]: makeLeafNode(notePath) }
        const graphNodes2 = { [notePath]: makeLeafNode(notePath) }

        const out1: FolderProjectionInfo[] = []
        collectFolderProjectionInfo(folder, graphNodes1, undefined, out1)

        const out2: FolderProjectionInfo[] = []
        collectFolderProjectionInfo(folder, graphNodes2, undefined, out2)

        expect(out1.length).toBeGreaterThan(0)
        expect(out1.length).toBe(out2.length)
        for (let i = 0; i < out1.length; i++) {
            expect(out2[i]).not.toBe(out1[i])
            expect(out2[i]).toEqual(out1[i])
        }
    })

    it('caches nested folder trees correctly', () => {
        const filePath = toAbsolutePath('/tmp/project/a/b/note.md')
        const innerFolder = {
            name: 'b',
            absolutePath: toAbsolutePath('/tmp/project/a/b'),
            loadState: 'loaded' as const,
            isWriteTarget: false,
            children: [{
                name: 'note.md',
                absolutePath: filePath,
                isInGraph: true,
            }],
        }
        const outerFolder = {
            name: 'a',
            absolutePath: toAbsolutePath('/tmp/project/a'),
            loadState: 'loaded' as const,
            isWriteTarget: false,
            children: [innerFolder],
        }
        const graphNodes = { [filePath]: makeLeafNode(filePath) }

        const out1: FolderProjectionInfo[] = []
        collectFolderProjectionInfo(outerFolder, graphNodes, undefined, out1)

        const out2: FolderProjectionInfo[] = []
        collectFolderProjectionInfo(outerFolder, graphNodes, undefined, out2)

        expect(out1.length).toBe(2)
        expect(out1.length).toBe(out2.length)
        for (let i = 0; i < out1.length; i++) {
            expect(out2[i]).toBe(out1[i])
        }
    })
})

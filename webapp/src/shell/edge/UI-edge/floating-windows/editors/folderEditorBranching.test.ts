import {describe, expect, it} from 'vitest'
import * as O from 'fp-ts/lib/Option.js'

import type {GraphDelta, GraphNode} from '@vt/graph-model/pure/graph'
import {createEmptyGraph, createGraph} from '@vt/graph-model/pure/graph/createGraph'
import {getFolderNotePath} from '@vt/graph-model'
import {parseMarkdownToGraphNode} from '@vt/graph-model/pure/graph/markdown-parsing'

import {resolveFolderSaveTarget} from './modifyNodeContentFromFloatingEditor'

function createLeafNode(nodeId: string, content: string): GraphNode {
    return {
        kind: 'leaf',
        absoluteFilePathIsID: nodeId,
        contentWithoutYamlOrLinks: content,
        outgoingEdges: [],
        nodeUIMetadata: {
            color: O.none,
            position: O.none,
            additionalYAMLProps: new Map(),
            isContextNode: false,
        },
    }
}

describe('folder editor branching', () => {
    it('resolves folder-note ids through getFolderNotePath for folder editors', () => {
        const graph = createGraph({
            '/vault/topic/index.md': createLeafNode('/vault/topic/index.md', '# Topic'),
            '/vault/topic/child.md': createLeafNode('/vault/topic/child.md', '# Child'),
        })

        expect(getFolderNotePath(graph, '/vault/topic/')).toBe('/vault/topic/index.md')
    })

    it('translates folder save targets to index.md and leaves leaf ids unchanged', () => {
        expect(resolveFolderSaveTarget('/vault/topic.md')).toBe('/vault/topic.md')
        expect(resolveFolderSaveTarget('/vault/topic/')).toBe('/vault/topic/index.md')
        expect(resolveFolderSaveTarget('/vault/topic//')).toBe('/vault/topic//index.md')
    })

    it('builds a first-save UpsertNode delta for a missing folder index', () => {
        const emptyGraph = createEmptyGraph()
        const node = parseMarkdownToGraphNode('# Topic', '/vault/topic/index.md', emptyGraph)
        const delta: GraphDelta = [{
            type: 'UpsertNode',
            nodeToUpsert: node,
            previousNode: O.none,
        }]

        expect(delta[0]?.type).toBe('UpsertNode')
        if (delta[0]?.type !== 'UpsertNode') {
            throw new Error('Expected UpsertNode delta')
        }
        expect(delta[0].nodeToUpsert.absoluteFilePathIsID).toBe('/vault/topic/index.md')
        expect(delta[0].nodeToUpsert.kind).toBe('leaf')
    })
})

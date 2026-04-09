import { describe, expect, it } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { createGraph } from '../../createGraph'
import type { Graph, GraphNode } from '../..'
import { computeExtractIntoFolderGraphDelta, getExtractIntoFolderSelectionSupport } from './computeExtractIntoFolderGraphDelta'

function createTestNode(
    id: string,
    position?: { x: number; y: number }
): GraphNode {
    return {
        absoluteFilePathIsID: id,
        outgoingEdges: [],
        contentWithoutYamlOrLinks: `# ${id}`,
        nodeUIMetadata: {
            color: O.none,
            position: position ? O.some(position) : O.none,
            additionalYAMLProps: new Map(),
            isContextNode: false
        }
    }
}

describe('computeExtractIntoFolderGraphDelta', () => {
    it('supports same-parent absolute file selections', () => {
        const selectedItemIds = [
            '/tmp/vault/alpha.md',
            '/tmp/vault/beta.md'
        ]

        expect(getExtractIntoFolderSelectionSupport(selectedItemIds)).toEqual({
            canExtract: true,
            commonParentPath: '/tmp/vault/',
            supportedSelectionCount: 2
        })
    })

    it('creates move + hub + delete deltas for same-parent file selections', () => {
        const graph: Graph = createGraph({
            '/tmp/vault/alpha.md': createTestNode('/tmp/vault/alpha.md', { x: 100, y: 100 }),
            '/tmp/vault/beta.md': createTestNode('/tmp/vault/beta.md', { x: 200, y: 100 }),
            '/tmp/vault/overview.md': createTestNode('/tmp/vault/overview.md', { x: 300, y: 100 })
        })

        const delta = computeExtractIntoFolderGraphDelta(
            ['/tmp/vault/alpha.md', '/tmp/vault/beta.md'],
            graph,
            '/tmp/vault'
        )

        expect(delta.length).toBeGreaterThan(0)

        const upsertIds = delta
            .filter((nodeDelta): nodeDelta is Extract<typeof delta[number], { type: 'UpsertNode' }> => nodeDelta.type === 'UpsertNode')
            .map((nodeDelta) => nodeDelta.nodeToUpsert.absoluteFilePathIsID)

        expect(upsertIds.some((nodeId) => nodeId.includes('/extract_') && nodeId.endsWith('/alpha.md'))).toBe(true)
        expect(upsertIds.some((nodeId) => nodeId.includes('/extract_') && nodeId.endsWith('/beta.md'))).toBe(true)
        expect(upsertIds.some((nodeId) => nodeId.includes('/extract_') && nodeId.endsWith('.md') && nodeId.includes('/hub_'))).toBe(true)

        const deletedIds = delta
            .filter((nodeDelta): nodeDelta is Extract<typeof delta[number], { type: 'DeleteNode' }> => nodeDelta.type === 'DeleteNode')
            .map((nodeDelta) => nodeDelta.nodeId)

        expect(deletedIds).toEqual(expect.arrayContaining([
            '/tmp/vault/alpha.md',
            '/tmp/vault/beta.md'
        ]))
    })
})

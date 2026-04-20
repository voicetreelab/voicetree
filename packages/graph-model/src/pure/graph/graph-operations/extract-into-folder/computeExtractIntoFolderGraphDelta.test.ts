import { describe, expect, it } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { createGraph } from '../../createGraph'
import type { Graph, GraphNode } from '../..'
import { computeExtractIntoFolderGraphDelta, getExtractIntoFolderSelectionSupport } from './computeExtractIntoFolderGraphDelta'

function createTestNode(
    id: string,
    options?: {
        readonly position?: { x: number; y: number }
        readonly outgoingEdges?: readonly GraphNode['outgoingEdges'][number][]
        readonly contentWithoutYamlOrLinks?: string
    }
): GraphNode {
    return {
        absoluteFilePathIsID: id,
        outgoingEdges: options?.outgoingEdges ?? [],
        contentWithoutYamlOrLinks: options?.contentWithoutYamlOrLinks ?? `# ${id}`,
        nodeUIMetadata: {
            color: O.none,
            position: options?.position ? O.some(options.position) : O.none,
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
            '/tmp/vault/alpha.md': createTestNode('/tmp/vault/alpha.md', { position: { x: 100, y: 100 } }),
            '/tmp/vault/beta.md': createTestNode('/tmp/vault/beta.md', { position: { x: 200, y: 100 } }),
            '/tmp/vault/overview.md': createTestNode('/tmp/vault/overview.md', { position: { x: 300, y: 100 } })
        })

        const { delta, newFolderId } = computeExtractIntoFolderGraphDelta(
            ['/tmp/vault/alpha.md', '/tmp/vault/beta.md'],
            graph,
            '/tmp/vault'
        )

        expect(delta.length).toBeGreaterThan(0)
        expect(newFolderId).toMatch(/^\/tmp\/vault\/extract_[a-z0-9_]+\/$/)

        const upsertIds = delta
            .filter((nodeDelta): nodeDelta is Extract<typeof delta[number], { type: 'UpsertNode' }> => nodeDelta.type === 'UpsertNode')
            .map((nodeDelta) => nodeDelta.nodeToUpsert.absoluteFilePathIsID)

        expect(upsertIds.some((nodeId) => nodeId === `${newFolderId}alpha.md`)).toBe(true)
        expect(upsertIds.some((nodeId) => nodeId === `${newFolderId}beta.md`)).toBe(true)
        expect(upsertIds.some((nodeId) => nodeId.startsWith(newFolderId!) && nodeId.endsWith('.md') && nodeId.includes('/hub_'))).toBe(true)

        const deletedIds = delta
            .filter((nodeDelta): nodeDelta is Extract<typeof delta[number], { type: 'DeleteNode' }> => nodeDelta.type === 'DeleteNode')
            .map((nodeDelta) => nodeDelta.nodeId)

        expect(deletedIds).toEqual(expect.arrayContaining([
            '/tmp/vault/alpha.md',
            '/tmp/vault/beta.md'
        ]))
    })

    it('retargets basename folder links when extracting a selected folder', () => {
        const graph: Graph = createGraph({
            '/tmp/vault/docs/intro.md': createTestNode('/tmp/vault/docs/intro.md'),
            '/tmp/vault/docs/architecture.md': createTestNode('/tmp/vault/docs/architecture.md'),
            '/tmp/vault/overview.md': createTestNode('/tmp/vault/overview.md'),
            '/tmp/vault/references.md': createTestNode('/tmp/vault/references.md', {
                outgoingEdges: [{ targetId: 'docs', label: 'See' }],
                contentWithoutYamlOrLinks: '# References\n\nSee [docs]* for details.'
            })
        })

        const { delta } = computeExtractIntoFolderGraphDelta(
            ['/tmp/vault/docs/', '/tmp/vault/overview.md'],
            graph,
            '/tmp/vault'
        )

        const upserts = delta.filter((nodeDelta): nodeDelta is Extract<typeof delta[number], { type: 'UpsertNode' }> => {
            return nodeDelta.type === 'UpsertNode'
        })

        const movedDocsIntro = upserts.find((nodeDelta) => {
            return nodeDelta.nodeToUpsert.absoluteFilePathIsID.endsWith('/docs/intro.md')
        })?.nodeToUpsert

        expect(movedDocsIntro).toBeDefined()

        const expectedFolderTargetId = movedDocsIntro!.absoluteFilePathIsID.slice(0, -'intro.md'.length)
        const referencesUpsert = upserts.find((nodeDelta) => {
            return nodeDelta.nodeToUpsert.absoluteFilePathIsID === '/tmp/vault/references.md'
        })?.nodeToUpsert

        expect(referencesUpsert).toBeDefined()
        expect(referencesUpsert!.outgoingEdges).toEqual([
            {
                targetId: expectedFolderTargetId,
                label: 'See'
            }
        ])
        expect(referencesUpsert!.contentWithoutYamlOrLinks).toContain(`[${expectedFolderTargetId}]*`)
        expect(referencesUpsert!.contentWithoutYamlOrLinks).not.toContain('[docs]*')
    })

    it('rejects selections that do not share the same parent folder', () => {
        const selectedItemIds = [
            '/tmp/vault/alpha.md',
            '/tmp/vault/nested/beta.md'
        ]

        expect(getExtractIntoFolderSelectionSupport(selectedItemIds)).toEqual({
            canExtract: false,
            commonParentPath: null,
            supportedSelectionCount: 0
        })
    })
})

import { describe, expect, it } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { createGraph } from '../../construction/createGraph'
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
        kind: 'leaf',
        absoluteFilePathIsID: id,
        outgoingEdges: options?.outgoingEdges ?? [],
        contentWithoutYamlOrLinks: options?.contentWithoutYamlOrLinks ?? `# ${id}`,
        nodeUIMetadata: {
            color: O.none,
            position: options?.position ? O.some(options.position) : O.none,
            additionalYAMLProps: {},
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
            supportedSelectionCount: 2,
            selectionsShareParent: true
        })
    })

    it('creates move + index.md + delete deltas for same-parent file selections', () => {
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

        const upserts = delta
            .filter((nodeDelta): nodeDelta is Extract<typeof delta[number], { type: 'UpsertNode' }> => nodeDelta.type === 'UpsertNode')
            .map((nodeDelta) => nodeDelta.nodeToUpsert)

        expect(upserts.some((node) => node.absoluteFilePathIsID === `${newFolderId}alpha.md`)).toBe(true)
        expect(upserts.some((node) => node.absoluteFilePathIsID === `${newFolderId}beta.md`)).toBe(true)

        const folderIndexNote = upserts.find((node) => node.absoluteFilePathIsID === `${newFolderId}index.md`)
        expect(folderIndexNote).toBeDefined()
        expect(folderIndexNote!.outgoingEdges).toEqual([])
        expect(folderIndexNote!.contentWithoutYamlOrLinks).toBe('Contains 2 nodes.')

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

    it('reports cross-parent selections as extractable with longest common ancestor', () => {
        const selectedItemIds = [
            '/tmp/vault/alpha.md',
            '/tmp/vault/nested/beta.md'
        ]

        expect(getExtractIntoFolderSelectionSupport(selectedItemIds)).toEqual({
            canExtract: true,
            commonParentPath: '/tmp/vault/',
            supportedSelectionCount: 2,
            selectionsShareParent: false
        })
    })

    it('reports common ancestor for deeper differing parents', () => {
        const selectedItemIds = [
            '/tmp/vault/foo/x.md',
            '/tmp/vault/bar/y.md'
        ]

        expect(getExtractIntoFolderSelectionSupport(selectedItemIds)).toEqual({
            canExtract: true,
            commonParentPath: '/tmp/vault/',
            supportedSelectionCount: 2,
            selectionsShareParent: false
        })
    })

    it('extracts cross-parent selections into a new folder at the common ancestor', () => {
        const graph: Graph = createGraph({
            '/tmp/vault/foo/alpha.md': createTestNode('/tmp/vault/foo/alpha.md', { position: { x: 100, y: 100 } }),
            '/tmp/vault/bar/beta.md': createTestNode('/tmp/vault/bar/beta.md', { position: { x: 200, y: 100 } })
        })

        const { delta, newFolderId } = computeExtractIntoFolderGraphDelta(
            ['/tmp/vault/foo/alpha.md', '/tmp/vault/bar/beta.md'],
            graph,
            '/tmp/vault'
        )

        expect(newFolderId).toMatch(/^\/tmp\/vault\/extract_[a-z0-9_]+\/$/)

        const upsertIds = delta
            .filter((nodeDelta): nodeDelta is Extract<typeof delta[number], { type: 'UpsertNode' }> => nodeDelta.type === 'UpsertNode')
            .map((nodeDelta) => nodeDelta.nodeToUpsert.absoluteFilePathIsID)

        expect(upsertIds.some((nodeId) => nodeId === `${newFolderId}foo/alpha.md`)).toBe(true)
        expect(upsertIds.some((nodeId) => nodeId === `${newFolderId}bar/beta.md`)).toBe(true)

        const deletedIds = delta
            .filter((nodeDelta): nodeDelta is Extract<typeof delta[number], { type: 'DeleteNode' }> => nodeDelta.type === 'DeleteNode')
            .map((nodeDelta) => nodeDelta.nodeId)

        expect(deletedIds).toEqual(expect.arrayContaining([
            '/tmp/vault/foo/alpha.md',
            '/tmp/vault/bar/beta.md'
        ]))
    })

    it('honors the folderName override when provided', () => {
        const graph: Graph = createGraph({
            '/tmp/vault/alpha.md': createTestNode('/tmp/vault/alpha.md'),
            '/tmp/vault/beta.md': createTestNode('/tmp/vault/beta.md')
        })

        const { newFolderId } = computeExtractIntoFolderGraphDelta(
            ['/tmp/vault/alpha.md', '/tmp/vault/beta.md'],
            graph,
            '/tmp/vault',
            'my custom name'
        )

        expect(newFolderId).toBe('/tmp/vault/my custom name/')
    })

    it('falls back to generated name when override is blank', () => {
        const graph: Graph = createGraph({
            '/tmp/vault/alpha.md': createTestNode('/tmp/vault/alpha.md'),
            '/tmp/vault/beta.md': createTestNode('/tmp/vault/beta.md')
        })

        const { newFolderId } = computeExtractIntoFolderGraphDelta(
            ['/tmp/vault/alpha.md', '/tmp/vault/beta.md'],
            graph,
            '/tmp/vault',
            '   '
        )

        expect(newFolderId).toMatch(/^\/tmp\/vault\/extract_[a-z0-9_]+\/$/)
    })
})

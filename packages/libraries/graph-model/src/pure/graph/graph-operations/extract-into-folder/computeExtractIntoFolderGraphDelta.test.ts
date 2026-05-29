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
            '/tmp/project/alpha.md',
            '/tmp/project/beta.md'
        ]

        expect(getExtractIntoFolderSelectionSupport(selectedItemIds)).toEqual({
            canExtract: true,
            commonParentPath: '/tmp/project/',
            supportedSelectionCount: 2,
            selectionsShareParent: true
        })
    })

    it('creates move + index.md + delete deltas for same-parent file selections', () => {
        const graph: Graph = createGraph({
            '/tmp/project/alpha.md': createTestNode('/tmp/project/alpha.md', { position: { x: 100, y: 100 } }),
            '/tmp/project/beta.md': createTestNode('/tmp/project/beta.md', { position: { x: 200, y: 100 } }),
            '/tmp/project/overview.md': createTestNode('/tmp/project/overview.md', { position: { x: 300, y: 100 } })
        })

        const { delta, newFolderId } = computeExtractIntoFolderGraphDelta(
            ['/tmp/project/alpha.md', '/tmp/project/beta.md'],
            graph,
            '/tmp/project'
        )

        expect(delta.length).toBeGreaterThan(0)
        expect(newFolderId).toMatch(/^\/tmp\/project\/extract_[a-z0-9_]+\/$/)

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
            '/tmp/project/alpha.md',
            '/tmp/project/beta.md'
        ]))
    })

    it('retargets basename folder links when extracting a selected folder', () => {
        const graph: Graph = createGraph({
            '/tmp/project/docs/intro.md': createTestNode('/tmp/project/docs/intro.md'),
            '/tmp/project/docs/architecture.md': createTestNode('/tmp/project/docs/architecture.md'),
            '/tmp/project/overview.md': createTestNode('/tmp/project/overview.md'),
            '/tmp/project/references.md': createTestNode('/tmp/project/references.md', {
                outgoingEdges: [{ targetId: 'docs', label: 'See' }],
                contentWithoutYamlOrLinks: '# References\n\nSee [docs]* for details.'
            })
        })

        const { delta } = computeExtractIntoFolderGraphDelta(
            ['/tmp/project/docs/', '/tmp/project/overview.md'],
            graph,
            '/tmp/project'
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
            return nodeDelta.nodeToUpsert.absoluteFilePathIsID === '/tmp/project/references.md'
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
            '/tmp/project/alpha.md',
            '/tmp/project/nested/beta.md'
        ]

        expect(getExtractIntoFolderSelectionSupport(selectedItemIds)).toEqual({
            canExtract: true,
            commonParentPath: '/tmp/project/',
            supportedSelectionCount: 2,
            selectionsShareParent: false
        })
    })

    it('reports common ancestor for deeper differing parents', () => {
        const selectedItemIds = [
            '/tmp/project/foo/x.md',
            '/tmp/project/bar/y.md'
        ]

        expect(getExtractIntoFolderSelectionSupport(selectedItemIds)).toEqual({
            canExtract: true,
            commonParentPath: '/tmp/project/',
            supportedSelectionCount: 2,
            selectionsShareParent: false
        })
    })

    it('extracts cross-parent selections into a new folder at the common ancestor', () => {
        const graph: Graph = createGraph({
            '/tmp/project/foo/alpha.md': createTestNode('/tmp/project/foo/alpha.md', { position: { x: 100, y: 100 } }),
            '/tmp/project/bar/beta.md': createTestNode('/tmp/project/bar/beta.md', { position: { x: 200, y: 100 } })
        })

        const { delta, newFolderId } = computeExtractIntoFolderGraphDelta(
            ['/tmp/project/foo/alpha.md', '/tmp/project/bar/beta.md'],
            graph,
            '/tmp/project'
        )

        expect(newFolderId).toMatch(/^\/tmp\/project\/extract_[a-z0-9_]+\/$/)

        const upsertIds = delta
            .filter((nodeDelta): nodeDelta is Extract<typeof delta[number], { type: 'UpsertNode' }> => nodeDelta.type === 'UpsertNode')
            .map((nodeDelta) => nodeDelta.nodeToUpsert.absoluteFilePathIsID)

        expect(upsertIds.some((nodeId) => nodeId === `${newFolderId}foo/alpha.md`)).toBe(true)
        expect(upsertIds.some((nodeId) => nodeId === `${newFolderId}bar/beta.md`)).toBe(true)

        const deletedIds = delta
            .filter((nodeDelta): nodeDelta is Extract<typeof delta[number], { type: 'DeleteNode' }> => nodeDelta.type === 'DeleteNode')
            .map((nodeDelta) => nodeDelta.nodeId)

        expect(deletedIds).toEqual(expect.arrayContaining([
            '/tmp/project/foo/alpha.md',
            '/tmp/project/bar/beta.md'
        ]))
    })

    it('honors the folderName override when provided', () => {
        const graph: Graph = createGraph({
            '/tmp/project/alpha.md': createTestNode('/tmp/project/alpha.md'),
            '/tmp/project/beta.md': createTestNode('/tmp/project/beta.md')
        })

        const { newFolderId } = computeExtractIntoFolderGraphDelta(
            ['/tmp/project/alpha.md', '/tmp/project/beta.md'],
            graph,
            '/tmp/project',
            'my custom name'
        )

        expect(newFolderId).toBe('/tmp/project/my custom name/')
    })

    it('falls back to generated name when override is blank', () => {
        const graph: Graph = createGraph({
            '/tmp/project/alpha.md': createTestNode('/tmp/project/alpha.md'),
            '/tmp/project/beta.md': createTestNode('/tmp/project/beta.md')
        })

        const { newFolderId } = computeExtractIntoFolderGraphDelta(
            ['/tmp/project/alpha.md', '/tmp/project/beta.md'],
            graph,
            '/tmp/project',
            '   '
        )

        expect(newFolderId).toMatch(/^\/tmp\/project\/extract_[a-z0-9_]+\/$/)
    })
})

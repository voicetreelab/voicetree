import { describe, expect, it } from 'vitest'
import * as O from 'fp-ts/lib/Option.js'
import { createGraph } from '../../construction/createGraph'
import { applyGraphDeltaToGraph } from '../../graphDelta/applyGraphDeltaToGraph'
import { reverseDelta } from '../../undo/reverseDelta'
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

    // Cross-linked nodes plus an external linker — the real-world shape that the
    // link-free e2e fixtures never exercise. Edge targetIds are resolved absolute
    // ids and the inline links are `[basename]*` placeholders, exactly as the
    // markdown parser produces them.
    function crossLinkedProject(): Record<string, GraphNode> {
        return {
            '/tmp/project/defects.md': createTestNode('/tmp/project/defects.md', {
                position: { x: 100, y: 100 },
                outgoingEdges: [{ targetId: '/tmp/project/rootcause.md', label: '' }],
                contentWithoutYamlOrLinks: '# Defects\n\n- parent [rootcause]*'
            }),
            '/tmp/project/rootcause.md': createTestNode('/tmp/project/rootcause.md', {
                position: { x: 200, y: 100 }
            }),
            '/tmp/project/readme.md': createTestNode('/tmp/project/readme.md', {
                position: { x: 300, y: 100 },
                outgoingEdges: [{ targetId: '/tmp/project/defects.md', label: 'see' }],
                contentWithoutYamlOrLinks: '# Readme\n\nSee [defects]* for details.'
            })
        }
    }

    it('preserves bare-basename links across the move instead of absolutising them', () => {
        const original: Graph = createGraph(crossLinkedProject())

        const { delta, newFolderId } = computeExtractIntoFolderGraphDelta(
            ['/tmp/project/defects.md', '/tmp/project/rootcause.md'],
            original,
            '/tmp/project'
        )

        const upserts = delta
            .filter((nodeDelta): nodeDelta is Extract<typeof delta[number], { type: 'UpsertNode' }> => nodeDelta.type === 'UpsertNode')
            .map((nodeDelta) => nodeDelta.nodeToUpsert)

        // Intra-folder link: defects -> rootcause. Both moved together; the bare
        // basename still resolves, so the inline link text must stay `[rootcause]*`,
        // never the absolute folder path.
        const movedDefects = upserts.find((node) => node.absoluteFilePathIsID === `${newFolderId}defects.md`)
        expect(movedDefects).toBeDefined()
        expect(movedDefects!.contentWithoutYamlOrLinks).toContain('[rootcause]*')
        expect(movedDefects!.contentWithoutYamlOrLinks).not.toContain(newFolderId)
        // The graph edge is still retargeted to the moved node (connectivity intact).
        expect(movedDefects!.outgoingEdges).toEqual([{ targetId: `${newFolderId}rootcause.md`, label: '' }])

        // External link into the moved set: readme -> defects. The basename still
        // resolves to the moved node, so readme's inline text stays `[defects]*`.
        const externalReadme = upserts.find((node) => node.absoluteFilePathIsID === '/tmp/project/readme.md')
        expect(externalReadme).toBeDefined()
        expect(externalReadme!.contentWithoutYamlOrLinks).toContain('[defects]*')
        expect(externalReadme!.contentWithoutYamlOrLinks).not.toContain(newFolderId)
        expect(externalReadme!.outgoingEdges).toEqual([{ targetId: `${newFolderId}defects.md`, label: 'see' }])
    })

    it('is fully invertible: applying the extract delta then its reverse restores the original graph', () => {
        // Undoing the extraction (the user pressed Ctrl+Z) must round-trip back to
        // the original graph: no duplicate files left inside the folder, no orphaned
        // index.md.
        const nodes: Record<string, GraphNode> = crossLinkedProject()
        const original: Graph = createGraph(nodes)

        const { delta } = computeExtractIntoFolderGraphDelta(
            ['/tmp/project/defects.md', '/tmp/project/rootcause.md'],
            original,
            '/tmp/project'
        )

        const afterExtract: Graph = applyGraphDeltaToGraph(original, delta)
        const afterUndo: Graph = applyGraphDeltaToGraph(afterExtract, reverseDelta(delta))

        expect(Object.keys(afterUndo.nodes).sort()).toEqual(Object.keys(nodes).sort())
        expect(afterUndo.nodes).toEqual(original.nodes)
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

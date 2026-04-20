import path from 'node:path'
import {fileURLToPath} from 'node:url'
import {afterEach, describe, expect, it, vi} from 'vitest'
import {findCollapseBoundary} from '../src/collapseBoundary'
import {buildAutoViewGraph, buildPinnedClusters, renderAutoView} from '../src/autoView'

const testDir: string = path.dirname(fileURLToPath(import.meta.url))
const repoRoot: string = path.resolve(testDir, '../../..')
const fixturePath: string = path.join(repoRoot, 'packages/graph-tools/fixtures/folder-aware-fixture')

afterEach(() => {
    vi.restoreAllMocks()
})

describe('renderAutoView folder-aware pinning', () => {
    it('renders a pinned folder as a collapsed cluster at a generous budget', () => {
        const output = renderAutoView(fixturePath, {budget: 30, pinnedFolderIds: ['archive']}).output

        expect(output).toContain('# collapse: strategy=folder-first')
        expect(output).toContain('pinned=1')
        expect(output).toContain('# cluster: ▢ archive/ [collapsed: 4 nodes')
    })

    it('preserves existing output byte-for-byte when pinnedFolderIds is empty', () => {
        const baselineOutput = renderAutoView(fixturePath, {budget: 8}).output
        const emptyPinnedOutput = renderAutoView(fixturePath, {budget: 8, pinnedFolderIds: []}).output

        expect(emptyPinnedOutput).toBe(baselineOutput)
    })

    it('keeps pinned descendants out of the spine and out of auto-selected clusters', () => {
        const output = renderAutoView(fixturePath, {budget: 30, pinnedFolderIds: ['archive']}).output
        const graph = buildAutoViewGraph(fixturePath)
        const pinnedClusters = buildPinnedClusters(graph, ['archive'])
        const pinnedNodeIds = new Set(pinnedClusters.flatMap(cluster => cluster.nodeIds))
        const remainingNodes = graph.nodes.filter(node => !pinnedNodeIds.has(node.id))
        const autoClusters = findCollapseBoundary({rootName: graph.rootName, nodes: remainingNodes}, 5)

        expect(output).not.toContain('@[archive/index]')
        expect(output).not.toContain('@[archive/old-1]')
        expect(autoClusters.length).toBeGreaterThan(0)
        expect(autoClusters.some(cluster => cluster.nodeIds.some(nodeId => pinnedNodeIds.has(nodeId)))).toBe(false)
    })

    it('skips auto-selection entirely when pinning consumes the whole budget', () => {
        const output = renderAutoView(fixturePath, {budget: 1, pinnedFolderIds: ['archive', 'projects']}).output
        const clusterLines = output.split('\n').filter(line => line.startsWith('# cluster: '))

        expect(output).toContain('pinned=2')
        expect(clusterLines).toHaveLength(2)
        expect(clusterLines[0]).toContain('archive/')
        expect(clusterLines[1]).toContain('projects/')
        expect(output).not.toContain('# cluster: ▢ scratch/')
    })

    it('warns and skips pins that resolve to non-folder nodes', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const output = renderAutoView(fixturePath, {budget: 30, pinnedFolderIds: ['root-note']}).output

        expect(errorSpy).toHaveBeenCalledWith(
            '[folder-aware-view] ignoring pinned folder "root-note": resolved node "root-note.md" is not a folder',
        )
        expect(output).toContain('pinned=0')
        expect(output).not.toContain('# cluster: ▢ root-note/')
    })

    it('warns and skips pins that do not resolve to any folder', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
        const output = renderAutoView(fixturePath, {budget: 30, pinnedFolderIds: ['missing-folder']}).output

        expect(errorSpy).toHaveBeenCalledWith(
            '[folder-aware-view] ignoring pinned folder "missing-folder": no matching folder found',
        )
        expect(output).toContain('pinned=0')
        expect(output).not.toContain('# cluster: ▢ missing-folder/')
    })

    it('resolves pinned folders by absolute folder path as well as basename', () => {
        const graph = buildAutoViewGraph(fixturePath)
        const clusters = buildPinnedClusters(graph, ['archive', path.join(fixturePath, 'projects')])

        expect(clusters.map(cluster => cluster.label)).toEqual(['archive/', 'projects/'])
        expect(clusters[0]?.nodeIds).toHaveLength(4)
        expect(clusters[1]?.nodeIds).toHaveLength(4)
    })
})
